use bouml_ai::{apply_uml_patch, summarize_project_for_ai, uml_graph_patch_json_schema, UmlGraphPatch};
use bouml_codegen::{preview_classifier, TargetLanguage};
use bouml_core::{validate_project, Command, CommandHistory, ElementId, Project};
use bouml_persistence::save_project;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    #[serde(default)]
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
}

/// Language-agnostic JSON-RPC 2.0 & MCP (Model Context Protocol) server replacing BouML v4's
/// legacy `ToolCom`/`UmlCom` raw-pointer TCP protocol.
pub struct RpcServer {
    pub project: Project,
    pub history: CommandHistory,
    pub project_dir: Option<PathBuf>,
}

impl RpcServer {
    pub fn new(project: Project, project_dir: Option<PathBuf>) -> Self {
        Self {
            project,
            history: CommandHistory::new(),
            project_dir,
        }
    }

    /// Serves newline-delimited JSON-RPC 2.0 / MCP messages over stdin/stdout.
    pub fn serve_stdio(&mut self) -> io::Result<()> {
        let stdin = io::stdin();
        let mut stdout = io::stdout();
        for line in stdin.lock().lines() {
            let raw = line?;
            if raw.trim().is_empty() {
                continue;
            }
            let reply = self.handle_json(&raw);
            writeln!(stdout, "{reply}")?;
            stdout.flush()?;
        }
        Ok(())
    }

    /// Processes a single JSON-RPC 2.0 or MCP request and returns the JSON response string.
    pub fn handle_json(&mut self, raw: &str) -> String {
        let req: JsonRpcRequest = match serde_json::from_str(raw) {
            Ok(r) => r,
            Err(e) => {
                return serde_json::to_string(&JsonRpcResponse {
                    jsonrpc: "2.0",
                    id: Value::Null,
                    result: None,
                    error: Some(JsonRpcError {
                        code: -32700,
                        message: format!("Parse error: {e}"),
                    }),
                })
                .unwrap();
            }
        };

        let id = req.id.clone();
        let outcome = self.dispatch(&req.method, req.params);
        let resp = match outcome {
            Ok(result) => JsonRpcResponse {
                jsonrpc: "2.0",
                id,
                result: Some(result),
                error: None,
            },
            Err((code, message)) => JsonRpcResponse {
                jsonrpc: "2.0",
                id,
                result: None,
                error: Some(JsonRpcError { code, message }),
            },
        };
        serde_json::to_string(&resp).unwrap()
    }

    fn dispatch(&mut self, method: &str, params: Value) -> Result<Value, (i32, String)> {
        match method {
            // ---------------- MCP Handshake & Tool Discovery ----------------
            "initialize" => Ok(json!({
                "protocolVersion": "2024-11-05",
                "serverInfo": {
                    "name": "bouml-next-mcp",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {
                    "tools": {}
                }
            })),
            "tools/list" => Ok(json!({
                "tools": [
                    {
                        "name": "get_model_summary",
                        "description": "Return a concise summary of the UML 2.5 project and its diagnostics.",
                        "inputSchema": { "type": "object", "properties": {} }
                    },
                    {
                        "name": "validate_uml",
                        "description": "Validate UML 2.5 structural integrity, inheritance cycles, and SOLID heuristics.",
                        "inputSchema": { "type": "object", "properties": {} }
                    },
                    {
                        "name": "preview_code",
                        "description": "Generate live code preview for a classifier in any of the 8 supported languages.",
                        "inputSchema": {
                            "type": "object",
                            "required": ["classifier_id", "language"],
                            "properties": {
                                "classifier_id": { "type": "string" },
                                "language": { "type": "string" }
                            }
                        }
                    },
                    {
                        "name": "apply_uml_patch",
                        "description": "Atomically apply a schema-validated UmlGraphPatch to the UML 2.5 model.",
                        "inputSchema": uml_graph_patch_json_schema()
                    }
                ]
            })),
            "tools/call" => {
                let name = params["name"]
                    .as_str()
                    .ok_or((-32602, "missing tool 'name'".to_string()))?;
                let args = params["arguments"].clone();
                let tool_result = match name {
                    "get_model_summary" => Value::String(summarize_project_for_ai(&self.project)),
                    "validate_uml" => serde_json::to_value(validate_project(&self.project))
                        .map_err(|e| (-32603, e.to_string()))?,
                    "preview_code" => self.handle_preview_code(args)?,
                    "apply_uml_patch" => self.handle_apply_patch(args)?,
                    other => return Err((-32601, format!("unknown MCP tool '{other}'"))),
                };
                Ok(json!({
                    "content": [{
                        "type": "text",
                        "text": serde_json::to_string_pretty(&tool_result).unwrap_or_default()
                    }]
                }))
            }

            // ---------------- Native BouML JSON-RPC 2.0 Plug-out API ----------------
            "bouml/get_project" => {
                serde_json::to_value(&self.project).map_err(|e| (-32603, e.to_string()))
            }
            "bouml/get_stats" => {
                serde_json::to_value(self.project.stats()).map_err(|e| (-32603, e.to_string()))
            }
            "bouml/validate" => serde_json::to_value(validate_project(&self.project))
                .map_err(|e| (-32603, e.to_string())),
            "bouml/execute_command" => {
                let cmd: Command =
                    serde_json::from_value(params).map_err(|e| (-32602, e.to_string()))?;
                self.history
                    .execute(&mut self.project, cmd)
                    .map_err(|e| (-32000, e.to_string()))?;
                self.maybe_persist()?;
                Ok(json!({ "ok": true }))
            }
            "bouml/undo" => {
                self.history
                    .undo(&mut self.project)
                    .map_err(|e| (-32000, e.to_string()))?;
                self.maybe_persist()?;
                Ok(json!({ "ok": true }))
            }
            "bouml/redo" => {
                self.history
                    .redo(&mut self.project)
                    .map_err(|e| (-32000, e.to_string()))?;
                self.maybe_persist()?;
                Ok(json!({ "ok": true }))
            }
            "bouml/preview_code" => self.handle_preview_code(params),
            "bouml/apply_ai_patch" => self.handle_apply_patch(params),
            other => Err((-32601, format!("method not found: '{other}'"))),
        }
    }

    fn handle_preview_code(&self, params: Value) -> Result<Value, (i32, String)> {
        let clf_id = params["classifier_id"]
            .as_str()
            .ok_or((-32602, "missing 'classifier_id'".to_string()))?;
        let lang_str = params["language"]
            .as_str()
            .ok_or((-32602, "missing 'language'".to_string()))?;
        let lang: TargetLanguage = lang_str.parse().map_err(|e| (-32602, e))?;
        let files = preview_classifier(&self.project, &ElementId::from_raw(clf_id), lang, true)
            .map_err(|e| (-32000, e.to_string()))?;
        serde_json::to_value(files).map_err(|e| (-32603, e.to_string()))
    }

    fn handle_apply_patch(&mut self, params: Value) -> Result<Value, (i32, String)> {
        let patch: UmlGraphPatch =
            serde_json::from_value(params).map_err(|e| (-32602, e.to_string()))?;
        let report = apply_uml_patch(&mut self.project, &mut self.history, &patch)
            .map_err(|e| (-32000, e.to_string()))?;
        self.maybe_persist()?;
        serde_json::to_value(report).map_err(|e| (-32603, e.to_string()))
    }

    fn maybe_persist(&self) -> Result<(), (i32, String)> {
        if let Some(ref dir) = self.project_dir {
            save_project(&self.project, dir).map_err(|e| (-32001, e.to_string()))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_rpc_and_mcp_tools_work_end_to_end() {
        let mut server = RpcServer::new(Project::new("RpcDemo"), None);

        let init_resp: Value = serde_json::from_str(
            &server.handle_json(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#),
        )
        .unwrap();
        assert_eq!(init_resp["result"]["serverInfo"]["name"], "bouml-next-mcp");

        let tools_resp: Value = serde_json::from_str(
            &server.handle_json(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#),
        )
        .unwrap();
        assert_eq!(tools_resp["result"]["tools"].as_array().unwrap().len(), 4);

        let stats_resp: Value = serde_json::from_str(
            &server
                .handle_json(r#"{"jsonrpc":"2.0","id":3,"method":"bouml/get_stats","params":{}}"#),
        )
        .unwrap();
        assert_eq!(stats_resp["result"]["packages"], 1);
    }
}
