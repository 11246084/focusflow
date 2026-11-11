// Test-only preload: do not attempt to open any environment file.
require('dotenv').config = () => ({ parsed: {} });
