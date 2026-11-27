use crate::schema::{uml_graph_patch_json_schema, UmlGraphPatch};
use serde_json::{json, Value};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("HTTP request error: {0}")]
    Http(String),
    #[error("failed to parse structured JSON output from LLM: {0}")]
    InvalidJson(String),
    #[error("missing response content from provider")]
    EmptyResponse,
}

/// Configuration for the three native LLM backends (OpenAI, Anthropic, and local Ollama).
#[derive(Debug, Clone)]
pub enum AiProviderConfig {
    OpenAi {
        api_key: String,
        model: String,
        base_url: String,
    },
    Anthropic {
        api_key: String,
        model: String,
        base_url: String,
    },
    Ollama {
        host: String,
        model: String,
    },
}

impl AiProviderConfig {
    pub fn openai(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self::OpenAi {
            api_key: api_key.into(),
            model: model.into(),
            base_url: "https://api.openai.com/v1".to_string(),
        }
    }

    pub fn anthropic(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self::Anthropic {
            api_key: api_key.into(),
            model: model.into(),
            base_url: "https://api.anthropic.com/v1".to_string(),
        }
    }

    pub fn ollama(model: impl Into<String>) -> Self {
        Self::Ollama {
            host: "http://127.0.0.1:11434".to_string(),
            model: model.into(),
        }
    }
}

/// Abstraction over any LLM backend capable of returning a schema-validated `UmlGraphPatch`.
pub trait LlmClient {
    fn complete_uml_patch(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<UmlGraphPatch, ProviderError>;
}

/// Production HTTP client supporting OpenAI, Anthropic, and local Ollama Structured Outputs.
pub struct HttpLlmClient {
    config: AiProviderConfig,
}

impl HttpLlmClient {
    pub fn new(config: AiProviderConfig) -> Self {
        Self { config }
    }
}

impl LlmClient for HttpLlmClient {
    fn complete_uml_patch(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<UmlGraphPatch, ProviderError> {
        let schema = uml_graph_patch_json_schema();
        match &self.config {
            AiProviderConfig::OpenAi {
                api_key,
                model,
                base_url,
            } => {
                let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
                let payload = json!({
                    "model": model,
                    "messages": [
                        { "role": "system", "content": system_prompt },
                        { "role": "user", "content": user_prompt }
                    ],
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {
                            "name": "uml_graph_patch",
                            "schema": schema,
                            "strict": false
                        }
                    }
                });
                let resp: Value = ureq::post(&url)
                    .set("Authorization", &format!("Bearer {api_key}"))
                    .set("Content-Type", "application/json")
                    .send_json(payload)
                    .map_err(|e| ProviderError::Http(e.to_string()))?
                    .into_json()
                    .map_err(|e| ProviderError::InvalidJson(e.to_string()))?;

                let content = resp["choices"][0]["message"]["content"]
                    .as_str()
                    .ok_or(ProviderError::EmptyResponse)?;
                serde_json::from_str(content)
                    .map_err(|e| ProviderError::InvalidJson(format!("{e}: {content}")))
            }
            AiProviderConfig::Anthropic {
                api_key,
                model,
                base_url,
            } => {
                let url = format!("{}/messages", base_url.trim_end_matches('/'));
                let payload = json!({
                    "model": model,
                    "max_tokens": 4096,
                    "system": system_prompt,
                    "tools": [{
                        "name": "emit_uml_patch",
                        "description": "Emit a valid UML 2.5 graph patch conforming to the schema.",
                        "input_schema": schema
                    }],
                    "tool_choice": { "type": "tool", "name": "emit_uml_patch" },
                    "messages": [
                        { "role": "user", "content": user_prompt }
                    ]
                });
                let resp: Value = ureq::post(&url)
                    .set("x-api-key", api_key)
                    .set("anthropic-version", "2023-06-01")
                    .set("Content-Type", "application/json")
                    .send_json(payload)
                    .map_err(|e| ProviderError::Http(e.to_string()))?
                    .into_json()
                    .map_err(|e| ProviderError::InvalidJson(e.to_string()))?;

                let input = resp["content"]
                    .as_array()
                    .and_then(|arr| {
                        arr.iter()
                            .find(|item| item["type"] == "tool_use")
                            .map(|item| item["input"].clone())
                    })
                    .ok_or(ProviderError::EmptyResponse)?;
                serde_json::from_value(input)
                    .map_err(|e| ProviderError::InvalidJson(e.to_string()))
            }
            AiProviderConfig::Ollama { host, model } => {
                let url = format!("{}/api/chat", host.trim_end_matches('/'));
                let payload = json!({
                    "model": model,
                    "stream": false,
                    "format": schema,
                    "messages": [
                        { "role": "system", "content": system_prompt },
                        { "role": "user", "content": user_prompt }
                    ]
                });
                let resp: Value = ureq::post(&url)
                    .set("Content-Type", "application/json")
                    .send_json(payload)
                    .map_err(|e| ProviderError::Http(e.to_string()))?
                    .into_json()
                    .map_err(|e| ProviderError::InvalidJson(e.to_string()))?;

                let content = resp["message"]["content"]
                    .as_str()
                    .ok_or(ProviderError::EmptyResponse)?;
                serde_json::from_str(content)
                    .map_err(|e| ProviderError::InvalidJson(format!("{e}: {content}")))
            }
        }
    }
}
