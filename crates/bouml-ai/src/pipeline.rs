use crate::patch_applier::{apply_uml_patch, PatchApplyError, PatchApplyReport};
use crate::providers::{LlmClient, ProviderError};
use bouml_core::{validate_project, CommandHistory, Project};
use thiserror::Error;

const SYSTEM_PROMPT_UML: &str = r#"You are a Principal Software Architect and UML 2.5 expert inside BouML Next.
Given a functional specification, user stories, or a refactoring instruction, output a strictly valid UmlGraphPatch JSON object.
Rules:
1. Extract clean UML 2.5 packages, classes, interfaces, enumerations, typed attributes with multiplicities, operations (with realistic method bodies when appropriate), relationships, sequence interactions, and state machines.
2. Follow SOLID principles and avoid circular inheritance.
3. Every relation's `source` and `target` must match an existing or newly defined classifier name."#;

#[derive(Debug, Error)]
pub enum PipelineError {
    #[error("LLM provider error: {0}")]
    Provider(#[from] ProviderError),
    #[error("patch validation/application failed after retries: {0}")]
    Apply(#[from] PatchApplyError),
}

/// Text-to-UML pipeline: converts a natural-language specification or user stories into
/// validated UML 2.5 elements, interactions, state machines, and AutoElk diagrams.
/// Includes an automatic self-repair retry if the LLM emits an invalid cross-reference.
pub fn text_to_uml(
    client: &dyn LlmClient,
    project: &mut Project,
    history: &mut CommandHistory,
    specification: &str,
) -> Result<PatchApplyReport, PipelineError> {
    let mut prompt = format!(
        "Generate a complete UML 2.5 model from the following specification:\n\n{specification}"
    );

    for attempt in 0..2 {
        let patch = client.complete_uml_patch(SYSTEM_PROMPT_UML, &prompt)?;
        match apply_uml_patch(project, history, &patch) {
            Ok(report) => return Ok(report),
            Err(err) if attempt == 0 => {
                prompt = format!(
                    "{prompt}\n\nPrevious output failed validation with error: {err}. Fix the JSON patch and return only valid references."
                );
            }
            Err(err) => return Err(PipelineError::Apply(err)),
        }
    }
    unreachable!()
}

/// Conversational architecture refactoring pipeline: injects the current project's model
/// summary and UML 2.5 / SOLID diagnostics into the prompt and applies the resulting delta patch.
pub fn refactor_with_instruction(
    client: &dyn LlmClient,
    project: &mut Project,
    history: &mut CommandHistory,
    instruction: &str,
) -> Result<PatchApplyReport, PipelineError> {
    let context = summarize_project_for_ai(project);
    let prompt = format!(
        "Current UML 2.5 project state:\n{context}\n\nRefactoring instruction:\n{instruction}\n\nReturn a delta UmlGraphPatch applying this refactoring."
    );
    let patch = client.complete_uml_patch(SYSTEM_PROMPT_UML, &prompt)?;
    Ok(apply_uml_patch(project, history, &patch)?)
}

/// Produces a compact, token-efficient summary of a `Project` + its UML/SOLID diagnostics.
pub fn summarize_project_for_ai(project: &Project) -> String {
    let mut out = format!("Project: {}\nClassifiers:\n", project.name);
    for clf in project.classifiers.values() {
        let props: Vec<String> = clf.properties.iter().map(|p| p.meta.name.clone()).collect();
        let ops: Vec<String> = clf.operations.iter().map(|o| o.meta.name.clone()).collect();
        out.push_str(&format!(
            "- {:?} {} (props: [{}], ops: [{}])\n",
            clf.kind,
            clf.meta.name,
            props.join(", "),
            ops.join(", ")
        ));
    }
    let diags = validate_project(project);
    if !diags.is_empty() {
        out.push_str("Current Diagnostics:\n");
        for d in diags {
            out.push_str(&format!("- [{}] {}: {}\n", d.code, format!("{:?}", d.severity), d.message));
        }
    }
    out
}
