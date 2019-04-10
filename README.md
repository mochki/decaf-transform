# Decaffeinate & Transform tool

  By default, all the steps will be run in the current working directory.
  Additionally, we can specify a path with --path relative/path/to/dir.
  If any other flags are set, the tool will only run the steps specified.

## Usage
```
npx decaf-blah [options]
  -h                        shows this help
  -r                        replaces lines of code that say *.coffee to *.js
  -d                        decaffeinates coffee files & generates new js files
  -m                        removes coffee files
  -t                        runs transform (from js -> jsx)
  -e                        runs eslint --fix
  -p                        runs prettier
  --path relative/path      specify a specific directory to work in
```

Examples:
```
  npx decaf --path modules/projects     to run everything against projects
  npx decaf -p --path skeletor          runs prettier just in skeletor
  npx decaf -rd                         ro run first two steps (can compare
                                        new js files to old coffee)
```