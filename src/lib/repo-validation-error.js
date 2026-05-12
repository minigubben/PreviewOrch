class RepoValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "RepoValidationError";
    this.details = details;
  }
}

module.exports = {
  RepoValidationError,
};
