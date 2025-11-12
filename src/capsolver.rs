use std::{env, time::Instant};

use anyhow::{Context as _, Result, bail};
use serde::{Deserialize, Serialize};
use tracing::{debug, info};
use wreq::Client;
use wreq_util::Emulation;

use crate::error::CapSolverError;

const CREATE_TASK: &str = "https://api.capsolver.com/createTask";
const GET_TASK_RESULT: &str = "https://api.capsolver.com/getTaskResult";
const GET_BALANCE: &str = "https://api.capsolver.com/getBalance";

#[derive(Debug, Serialize)]
pub enum TaskType {
	#[serde(rename = "AntiTurnstileTaskProxyLess")]
	Turnstile,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateTaskPayload {
	client_key: String,
	task: Task,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Task {
	r#type: TaskType,
	website_key: String,
	website_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GetResultPayload {
	client_key: String,
	task_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
	Idle,
	Processing,
	Ready,
	Failed,
	#[serde(untagged)]
	Unknown(String),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTaskResponse {
	error_id: Option<u16>,
	error_description: Option<String>,
	task_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetTaskResponse {
	error_id: Option<u16>,
	error_description: Option<String>,
	status: Option<TaskStatus>,
	solution: Option<Solution>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Solution {
	token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BalancePayload {
	client_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BalanceResponse {
	error_id: Option<u16>,
	error_description: Option<String>,
	balance: Option<f64>,
}

async fn create_and_polltask(task_payload: CreateTaskPayload) -> Result<Solution> {
	let client = Client::builder().emulation(Emulation::Chrome142).build()?;

	let create_task_resp = client
		.post(CREATE_TASK)
		.header("Content-Type", "application/json")
		.json(&task_payload)
		.send()
		.await?;

	let create_task_data: CreateTaskResponse = create_task_resp.json().await?;

	if create_task_data.error_id.is_some() && create_task_data.error_id != Some(0) {
		bail!(CapSolverError::TaskCreation(
			create_task_data
				.error_description
				.unwrap_or_else(|| "Unknown error".to_string())
		));
	}

	let task_id = create_task_data
		.task_id
		.context("No taskId returned from Capsolver")?;

	info!("Task {} created. Polling for solution...", task_id);

	let get_result_payload = GetResultPayload {
		client_key: task_payload.client_key,
		task_id: task_id.clone(),
	};

	let start_time = Instant::now();

	loop {
		tokio::time::sleep(tokio::time::Duration::from_secs_f32(1.5)).await;

		let get_result_resp = client
			.post(GET_TASK_RESULT)
			.header("Content-Type", "application/json")
			.json(&get_result_payload)
			.send()
			.await?;

		let get_result_data: GetTaskResponse = get_result_resp.json().await?;

		if get_result_data.error_id.is_some() && get_result_data.error_id != Some(0) {
			bail!(CapSolverError::TaskResult(
				get_result_data
					.error_description
					.unwrap_or_else(|| "Unknown error".to_string())
			));
		}

		match get_result_data.status {
			Some(TaskStatus::Ready) => {
				let duration = start_time.elapsed().as_secs_f64();
				debug!("Successfully obtained solution in {:.2}s.", duration);

				let solution = get_result_data
					.solution
					.context("No solution in ready response")?;

				return Ok(solution);
			}
			Some(TaskStatus::Failed) => bail!(CapSolverError::CaptchaSolve),
			Some(TaskStatus::Idle) | Some(TaskStatus::Processing) | None => {
				debug!("Solution is processing...")
			}
			Some(TaskStatus::Unknown(status)) => bail!(CapSolverError::UnknownStatus(status)),
		}
	}
}

pub async fn solve_turnstile(site_key: String, url: String) -> Result<String> {
	let capsolver_key =
		env::var("CAPSOLVER_KEY").context("CAPSOLVER_KEY environment variable not set")?;

	get_capsolver_balance(&capsolver_key).await?;

	info!("Creating Capsolver task...");

	let task_payload = CreateTaskPayload {
		client_key: capsolver_key.clone(),
		task: Task {
			r#type: TaskType::Turnstile,
			website_key: site_key,
			website_url: url,
		},
	};

	// TODO: Potentially add a retry mechanism
	let Solution { token } = create_and_polltask(task_payload).await?;

	Ok(token)
}

pub async fn get_capsolver_balance(capsolver_key: &str) -> Result<()> {
	let client = Client::builder().emulation(Emulation::Chrome142).build()?;

	let balance_payload = BalancePayload {
		client_key: capsolver_key.to_string(),
	};

	let balance_response = client
		.post(GET_BALANCE)
		.header("Content-Type", "application/json")
		.json(&balance_payload)
		.send()
		.await?;

	let balance_data: BalanceResponse = balance_response.json().await?;

	if balance_data.error_id.is_some() && balance_data.error_id != Some(0) {
		bail!(CapSolverError::Balance(
			balance_data
				.error_description
				.unwrap_or_else(|| "Unknown error".to_string())
		))
	} else if let Some(balance) = balance_data.balance {
		info!("Capsolver Balance: ${}", balance);
	}

	Ok(())
}
