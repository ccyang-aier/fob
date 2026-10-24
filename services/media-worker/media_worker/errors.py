from fastapi.responses import JSONResponse


class WorkerError(Exception):
    def __init__(self, code: str, message: str, status: int, *, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.status = status
        self.retryable = retryable

    def response(self, request_id: str | None = None) -> JSONResponse:
        return JSONResponse(
            status_code=self.status,
            content={"requestId": request_id, "error": {
                "code": self.code, "message": str(self), "retryable": self.retryable,
            }},
        )
