import multiprocessing

import uvicorn

from .app import create_app
from .config import Settings


def main() -> None:
    multiprocessing.freeze_support()
    settings = Settings.from_environment()
    # Do not log request URLs: task resources contain presigned credentials.
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port,
                access_log=False, proxy_headers=False, server_header=False,
                timeout_graceful_shutdown=10)


if __name__ == "__main__":
    main()
