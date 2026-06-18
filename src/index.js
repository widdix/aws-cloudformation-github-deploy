// Executable entry point for the GitHub Action. ncc bundles this file into
// dist/index.js (referenced by action.yml). It is intentionally separate from
// main.js so the test suite can import { run } without auto-executing it.
import { run } from './main.js'

run()
