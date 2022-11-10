#!/usr/bin/env node
const Runner = require('jscodeshift/src/Runner')
const prettier = require('prettier')
const CLIEngine = require('eslint').CLIEngine
const decaffeinate = require('decaffeinate')
const minimist = require('minimist')
const {flattenDeep} = require('lodash')
const {readdir, readFile, stat, unlink, writeFile} = require('fs-extra')

;(async function main() {
  try {
    const {
      help,
      replace,git 
      decaffeinate,
      removeCoffeeFiles,
      transform,
      eslintFix,
      prettify,
      path,
      skipSubdirectories,
    } = parseArgs()
    const customized = replace || decaffeinate || removeCoffeeFiles || transform || eslintFix || prettify
    if (help) return showHelp()

    const workingDirectory = `${process.cwd()}${path ? `/${path}` : ''}`
    const isFile = workingDirectory.endsWith('.coffee')

    // Initial batch of files
    const files = isFile
      ? [workingDirectory]
      : await fetchAllFiles((await readdir(workingDirectory)).map(dir => `${path ? `${path}/` : ''}${dir}`), {
          skipSubdirectories,
        })
    const coffeeFiles = files.filter(file => file.endsWith('.coffee'))
    const replacementCandidates = files.filter(file => file.match(/\.(coffee|md)$/))

    if (replace || !customized) await replaceHardReferencesToCoffee(replacementCandidates) // r
    if (decaffeinate || !customized) await decaffeinateAllFiles(coffeeFiles) // d
    if (removeCoffeeFiles || !customized) await removeAllCoffeeFiles(coffeeFiles) // m

    // Files could change
    const jsFiles = (replace || decaffeinate || removeAllCoffeeFiles || !customized
      ? isFile
        ? [workingDirectory.replace('.coffee', '.js')]
        : await fetchAllFiles((await readdir(workingDirectory)).map(dir => `${path ? `${path}/` : ''}${dir}`), {
            skipSubdirectories,
          })
      : files
    ).filter(file => file.endsWith('.js'))

    if (transform || !customized) await runTransforms(jsFiles) // t
    if (eslintFix || !customized) eslintFixFiles(jsFiles) // e
    if (prettify || !customized) await prettifyFiles(jsFiles) // p
  } catch (e) {
    reportErrors(e)
  }
})()

async function fetchAllFiles(potentialDirectories, {skipSubdirectories}) {
  async function getFiles(dir, fileList = []) {
    const items = await readdir(dir)
    for (const item of items) {
      const itemPath = `${dir}${item}`
      if ((await stat(itemPath)).isDirectory()) {
        fileList = await getFiles(`${itemPath}/`, fileList)
      } else {
        fileList.push(itemPath)
      }
    }
    return fileList
  }

  const allFiles = []
  for (const directory of potentialDirectories) {
    if ((await stat(directory)).isDirectory() && !skipSubdirectories) {
      allFiles.push(await getFiles(`${directory}/`))
    } else {
      allFiles.push(directory)
    }
  }

  return flattenDeep(allFiles)
}

async function replaceHardReferencesToCoffee(files) {
  const totalCount = files.length
  console.log(`Patching all ${totalCount} files`)
  let progress = 0
  let percent = 0
  for (const file of files) {
    const fileSource = (await readFile(file, 'utf8')).split('\n')
    const patchedSource = fileSource
      .map(line => {
        if (line.includes('isCoffee')) return line // The one of case it needs to stay
        return line.replace('.coffee', '')
      })
      .join('\n')
    await writeFile(file, patchedSource)
    const newPercent = Math.floor((++progress / totalCount) * 100)
    if (percent !== newPercent) {
      percent = newPercent
      console.log(`Patched ${percent}%`)
    }
  }
  console.log('Patching complete')
}

async function decaffeinateAllFiles(coffeeFiles) {
  const totalCount = coffeeFiles.length
  console.log(`Decaffeinating all ${totalCount} files`)
  let progress = 0
  let percent = 0
  for (const file of coffeeFiles) {
    const converted = decaffeinate.convert(await readFile(file, 'utf8'))
    await writeFile(file.replace('.coffee', '.js'), converted.code)
    const newPercent = Math.floor((++progress / totalCount) * 100)
    if (percent !== newPercent) {
      percent = newPercent
      console.log(`Decaffeinated ${percent}%`)
    }
  }
  console.log('Decaffeination complete')
}

async function removeAllCoffeeFiles(coffeeFiles) {
  console.log(`Removing all ${coffeeFiles.length} coffee files`)
  for (const file of coffeeFiles) {
    await unlink(file)
  }
}

async function runTransforms(files) {
  console.log('Running codeshifts')
  await Runner.run(`${__dirname}/helpers/codeshifts.js`, files, {})
  console.log('Codeshifts complete')
}

function eslintFixFiles(files) {
  const cli = new CLIEngine({
    configFile: `${__dirname}/.eslintrc`,
    fix: true,
  })
  console.log('Running eslint --fix on all files')
  const report = cli.executeOnFiles(files)
  CLIEngine.outputFixes(report)
  console.log('All files eslint --fix ed')
}

async function prettifyFiles(files) {
  console.log('Running Prettier on all files')
  for (const file of files) {
    const formattedFile = prettier.format(await readFile(file, 'utf8'), {
      arrowParens: 'avoid',
      bracketSpacing: false,
      parser: 'babel',
      printWidth: 120,
      semi: false,
      singleQuote: true,
      tabWidth: 2,
      trailingComma: 'es5',
    })
    await writeFile(file, formattedFile)
  }
  console.log('All files Prettified')
}

function parseArgs() {
  const {
    h: help,
    r: replace,
    d: decaffeinate,
    m: removeCoffeeFiles,
    t: transform,
    e: eslintFix,
    p: prettify,
    path,
    'skip-subdirectories': skipSubdirectories,
  } = minimist(process.argv.slice(2))
  return {help, replace, decaffeinate, removeCoffeeFiles, transform, eslintFix, prettify, path, skipSubdirectories}
}

function showHelp() {
  console.log(`
    Decaffeinate & Transform tool

      By default, all the steps will be run in the current working directory.
      Additionally, we can specify a path with --path relative/path/to/dir.
      If any other flags are set, the tool will only run the steps specified.

    Usage:  npx decaf-transform [options]
      -h                        shows this help
      -r                        replaces lines of code that say *.coffee to no extension
      -d                        decaffeinates coffee files & generates new js files
      -m                        removes coffee files
      -t                        runs transform (from js -> jsx)
      -e                        runs eslint --fix
      -p                        runs prettier
      --path relative/path      specify a specific directory/file to work on
      --skip-subdirectories     Will only run on coffee files in the directory provided

    Examples:
      npx decaf-transform --path modules/projects     to run everything against projects
      npx decaf-transform -p --path skeletor          runs prettier just in skeletor
      npx decaf-transform -rd                         to run first two steps (can compare
                                                      new js files to old coffee)
    `)
}

function reportErrors(e) {
  console.error(`
    Report:
      Args: ${process.argv}
      Message: ${e}
  `)
}
