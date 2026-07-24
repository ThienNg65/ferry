#!/usr/bin/env node
const { spawn } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)
  let runs = 5
  let warmup = 1
  let binaryPath = null

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--runs=')) {
      runs = parseInt(arg.split('=')[1], 10) || 5
    } else if (arg === '--runs' && i + 1 < args.length) {
      runs = parseInt(args[++i], 10) || 5
    } else if (arg.startsWith('--warmup=')) {
      warmup = parseInt(arg.split('=')[1], 10) || 0
    } else if (arg.startsWith('--binary=')) {
      binaryPath = arg.split('=')[1]
    }
  }
  return { runs, warmup, binaryPath }
}

function getResolvedTarget(config) {
  if (config.binaryPath) {
    return { type: 'binary', path: path.resolve(config.binaryPath) }
  }
  const defaultPackagedExe = path.resolve(__dirname, '../dist/win-unpacked/Ferry.exe')
  if (fs.existsSync(defaultPackagedExe)) {
    return { type: 'binary', path: defaultPackagedExe }
  }
  return { type: 'electron', path: path.resolve(__dirname, '../out/main/index.js') }
}

function runSingleProfiling(runIndex, isWarmup, config) {
  return new Promise((resolve, reject) => {
    const tmpDir = path.join(os.tmpdir(), 'ferry-profile-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8))
    let electronExecutable
    let spawnArgs = []

    const target = getResolvedTarget(config)
    if (target.type === 'binary') {
      electronExecutable = target.path
      spawnArgs = ['--profile-startup', `--user-data-dir=${tmpDir}`, '--no-sandbox']
    } else {
      electronExecutable = require('electron')
      spawnArgs = [target.path, '--profile-startup', `--user-data-dir=${tmpDir}`, '--no-sandbox']
    }

    const env = {
      ...process.env,
      FERRY_PROFILE: '1',
      IS_PROFILING: 'true',
      NODE_ENV: 'production'
    }

    const child = spawn(electronExecutable, spawnArgs, {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdoutData = ''
    let stderrData = ''
    let parsedResult = null

    const cleanupTempDir = () => {
      try {
        if (fs.existsSync(tmpDir)) {
          fs.rmSync(tmpDir, { recursive: true, force: true })
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    const timeoutTimer = setTimeout(() => {
      child.kill('SIGKILL')
      cleanupTempDir()
      reject(new Error(`Run ${runIndex} timed out after 15000ms`))
    }, 15000)

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      stdoutData += text
      const lines = stdoutData.split('\n')
      for (const line of lines) {
        if (line.includes('[FERRY_PROFILE_RESULT]')) {
          const jsonStr = line.substring(line.indexOf('[FERRY_PROFILE_RESULT]') + '[FERRY_PROFILE_RESULT]'.length).trim()
          try {
            parsedResult = JSON.parse(jsonStr)
          } catch (e) {
            // Ignore partial line
          }
        }
      }
    })

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString('utf8')
    })

    child.on('exit', (code) => {
      clearTimeout(timeoutTimer)
      cleanupTempDir()
      if (parsedResult) {
        resolve(parsedResult)
      } else {
        reject(new Error(`Run ${runIndex} exited with code ${code} without profile output. Stderr: ${stderrData.slice(-300)}`))
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeoutTimer)
      cleanupTempDir()
      reject(err)
    })
  })
}

function calculateStats(numbers) {
  if (!numbers || numbers.length === 0) return { min: 0, max: 0, mean: 0, median: 0, stdDev: 0 }
  const sorted = [...numbers].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  const mean = sum / sorted.length

  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2

  const variance = sorted.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / sorted.length
  const stdDev = Math.sqrt(variance)

  return {
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100
  }
}

async function main() {
  const config = parseArgs()
  console.log(`\n======================================================`)
  console.log(`          FERRY STARTUP PROFILING RUNNER             `)
  console.log(`======================================================`)
  const target = getResolvedTarget(config)
  console.log(`Target: ${target.path}`)
  console.log(`Warmup runs: ${config.warmup}`)
  console.log(`Measured runs: ${config.runs}\n`)

  for (let w = 1; w <= config.warmup; w++) {
    process.stdout.write(`Executing warmup run ${w}/${config.warmup}... `)
    try {
      const result = await runSingleProfiling(`warmup-${w}`, true, config)
      console.log(`done (${result.totalStartupMs} ms, discarded)`)
    } catch (err) {
      console.log(`failed: ${err.message}`)
    }
  }

  const results = []
  for (let r = 1; r <= config.runs; r++) {
    process.stdout.write(`Executing measured run ${r}/${config.runs}... `)
    try {
      const result = await runSingleProfiling(r, false, config)
      results.push(result)
      console.log(`done (${result.totalStartupMs} ms)`)
    } catch (err) {
      console.log(`failed: ${err.message}`)
    }
    // Small inter-run cooldown
    await new Promise((res) => setTimeout(res, 500))
  }

  if (results.length === 0) {
    console.error('\nError: All profiling runs failed!')
    process.exit(1)
  }

  const totalTimes = results.map((r) => r.totalStartupMs)
  const stats = calculateStats(totalTimes)

  console.log(`\n------------------------------------------------------`)
  console.log(`Statistical Metrics across ${results.length} measured runs:`)
  console.log(`  Min:                ${stats.min.toFixed(2)} ms`)
  console.log(`  Max:                ${stats.max.toFixed(2)} ms`)
  console.log(`  Mean:               ${stats.mean.toFixed(2)} ms`)
  console.log(`  Median (P50):       ${stats.median.toFixed(2)} ms`)
  console.log(`  Std Deviation:        ${stats.stdDev.toFixed(2)} ms`)
  console.log(`------------------------------------------------------`)

  const meanPhaseMainToAppReady = calculateStats(results.map((r) => r.phases?.mainToAppReadyMs || 0)).mean
  const meanPhaseAppReadyToReadyToShow = calculateStats(results.map((r) => r.phases?.appReadyToReadyToShowMs || 0)).mean
  const meanPhaseReadyToShowToMount = calculateStats(results.map((r) => r.phases?.readyToShowToRendererMountMs || 0)).mean
  const meanPhaseMountToFirstPaint = calculateStats(results.map((r) => r.phases?.rendererMountToFirstPaintMs || 0)).mean

  console.log(`Phase Breakdown (Mean across runs):`)
  console.log(`  1. Main Init -> App Ready:       ${meanPhaseMainToAppReady.toFixed(2)} ms`)
  console.log(`  2. App Ready -> Ready to Show:    ${meanPhaseAppReadyToReadyToShow.toFixed(2)} ms`)
  console.log(`  3. Ready to Show -> Vue Mount:    ${meanPhaseReadyToShowToMount.toFixed(2)} ms`)
  console.log(`  4. Vue Mount -> First Paint:      ${meanPhaseMountToFirstPaint.toFixed(2)} ms`)
  console.log(`======================================================`)
  console.log(`Baseline Startup Time: ${stats.median.toFixed(2)} ms\n`)
}

main().catch((err) => {
  console.error('Fatal profiling runner error:', err)
  process.exit(1)
})
