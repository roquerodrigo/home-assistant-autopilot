#!/usr/bin/env node
import { runCommandLine } from './cli.ts'

process.exitCode = await runCommandLine(process.argv.slice(2), process.env, {
  error: (text) => process.stderr.write(text),
  write: (text) => process.stdout.write(text),
})
