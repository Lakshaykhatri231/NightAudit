"""Run the web UI + JSON API:  python3 app.py [--host 127.0.0.1] [--port 8000]"""
import argparse
import logging

from hotelreports import synthetic
from hotelreports.server import make_server


def main():
    parser = argparse.ArgumentParser(description="Hotel social-media reporting prototype")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    if not synthetic.sample_path("harbourlight").exists():
        synthetic.write_samples()

    httpd = make_server(args.host, args.port)
    print(f"\n  Hotel Reports running at http://{args.host}:{args.port}")
    print("  Demo logins (password demo123): anna@harbourlight, rob@harbourlight, "
          "paul@pinecrest, rita@pinecrest\n  Ctrl+C to stop.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
