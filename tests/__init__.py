import logging

# Cross-client denials are logged as warnings by design; keep test output clean.
logging.getLogger("hotelreports").setLevel(logging.CRITICAL)
