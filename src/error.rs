use thiserror::Error;
use wreq::StatusCode;

#[derive(Error, Debug)]
pub enum CapSolverError {
	#[error("Failed to create task reason: {0}")]
	TaskCreation(String),
	#[error("Failed to get task results reason: {0}")]
	TaskResult(String),
	#[error("Failed to get balance reason: {0}")]
	Balance(String),

	#[error("Failed to solve captcha")]
	CaptchaSolve,

	#[error("Network request failed: {0}")]
	Wreq(#[from] wreq::Error),

	#[error("Unknown Status: {0}")]
	UnknownStatus(String),
}

#[derive(Error, Debug)]
pub enum ScrapeError {
	#[error("Get with retry failed to get {0} error: {1}")]
	GetWithRetry(String, String),

	#[error("Network request failed: {0}")]
	Wreq(#[from] wreq::Error),
}

#[derive(Error, Debug)]
pub enum UtilsError {
	#[error("Failed to download file: {0}")]
	DownloadFile(StatusCode),

	#[error("Failed to fetch page: {0}")]
	FetchPage(StatusCode),

	#[error("Website rejected the verification")]
	VerificationRejection,

	#[error("Network request failed: {0}")]
	Wreq(#[from] wreq::Error),
}
