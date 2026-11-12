"""Application errors. Each carries the HTTP status the API should return."""


class AppError(Exception):
    status = 500

    def __init__(self, message: str, details=None):
        super().__init__(message)
        self.message = message
        self.details = details


class InvalidInput(AppError):
    status = 400


class Unauthorized(AppError):
    status = 401


class AccessDenied(AppError):
    status = 403


class NotFound(AppError):
    status = 404


class Conflict(AppError):
    """Action not allowed in the current state (e.g. export before approval)."""

    status = 409
