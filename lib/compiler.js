var register = require('ts-node').register
var fs = require('fs')
var path = require('path')
var os = require('os')
var mkdirp = require('mkdirp')
var rimraf = require('rimraf')
var { resolveSync } = require('tsconfig')

var tsHandler
var compiledFiles = {}

var getCompiledPath = require('./get-compiled-path')
var tmpDir = '.ts-node'

var extensions = ['.ts', '.tsx']
var empty = function () { }
var cwd = process.cwd()
var comilationInstanceStampt = new Date().getTime()

var compiler = {
  allowJs: false,
  tsConfigPath: '',
  getCompilationId: function () {
    return comilationInstanceStampt
  },
  getCompiledDir: function () {
    return path.join(tmpDir, 'compiled').replace(/\\/g, '/')
  },
  getCompileReqFilePath: function () {
    return path.join(compiler.getCompiledDir(), compiler.getCompilationId() + '.req')
  },
  getCompilerReadyFilePath: function () {
    return path.join(os.tmpdir(), 'ts-node-dev-ready-' + comilationInstanceStampt)
      .replace(/\\/g, '/')
  },  
  getChildHookPath: function () {
    return path.join(os.tmpdir(), 'ts-node-dev-hook-' + comilationInstanceStampt + '.js')
      .replace(/\\/g, '/')
  },
  writeReadyFile: function () {
    var fileData = fs.writeFileSync(compiler.getCompilerReadyFilePath(), '')
  },
  writeChildHookFile: function (options) {
    var fileData = fs.readFileSync(path.join(__dirname, 'child-require-hook.js'), 'utf-8')
    var compileTimeout = parseInt(options['compile-timeout'])
    if (compileTimeout) {
      fileData = fileData.replace('10000', compileTimeout.toString())
    }
    if (compiler.allowJs) {
      fileData = fileData.replace('allowJs = false', 'allowJs = true')
    }
    if (options['prefer-ts']) {
      fileData = fileData.replace('preferTs = false', 'preferTs = true')
    }
    if (options['ignore'] !== undefined) {
      var ignore = options['ignore']
      var ignoreVal = !ignore || ignore === 'false'
        ? 'false'
        : '[' + (Array.isArray(ignore) ? ignore : ignore.split(/, /))
          .map(ignore => 'new RegExp("' + ignore + '")').join(', ') + ']'
      fileData = fileData.replace('var ignore = [/node_modules/]', 'var ignore = ' + ignoreVal)
    }
    fileData = fileData.replace('var compilationId', 'var compilationId = "' + compiler.getCompilationId() + '"')
    fileData = fileData.replace('var compiledDir', 'var compiledDir = "' + compiler.getCompiledDir() + '"')
    fileData = fileData.replace('./get-compiled-path', path.join(__dirname, 'get-compiled-path').replace(/\\/g, '/'))
    fileData = fileData.replace('var readyFile',
      'var readyFile = "' + compiler.getCompilerReadyFilePath() + '"')
    fs.writeFileSync(compiler.getChildHookPath(), fileData)
  },
  init: function (options) {
    var project = options['project']
    compiler.tsConfigPath = resolveSync(cwd, typeof project === 'string' ? project : undefined) || ''

    var originalJsHandler = require.extensions['.js']
    require.extensions['.ts'] = empty
    require.extensions['.tsx'] = empty
    tmpDir = options['cache-directory']
      ? path.resolve(options['cache-directory'])
      : path.join(os.tmpdir(), '.ts-node')
    var compilerOptions
    if (options['compilerOptions']) {
      try {
        compilerOptions = JSON.parse(options['compilerOptions'])
      } catch (e) {
        console.log('Could not parse compilerOptions', options['compilerOptions'])
        console.log(e)
      }
    }
    
    var tsNodeOptions = {
      fast: options['fast'],
      cache: options['cache'] || !options['no-cache'],
      typeCheck: options['type-check'],
      cacheDirectory: options['cache-directory'] || path.join(tmpDir, 'cache'),
      compiler: options['compiler'],
      project: options['project'],
      skipProject: options['skip-project'],
      skipIgnore: options['skip-ignore'],
      ignore: options['ignore'] || process.env['TS_NODE_IGNORE'],
      ignoreWarnings: options['ignoreWarnings'] || options['ignoreDiagnostics'],
      ignoreDiagnostics: options['ignoreDiagnostics'],
      disableWarnings: options['disableWarnings'],
      compilerOptions: compilerOptions
    }    
    try {
      register(tsNodeOptions)
    } catch (e) {
      console.log(e)
      return
    }

    /* clean up compiled on each new init*/
    rimraf.sync(compiler.getCompiledDir())
    mkdirp.sync(compiler.getCompiledDir())
    /* check if `allowJs` compiler option enable */
    var allowJsEnabled = require.extensions['.js'] !== originalJsHandler
    if (allowJsEnabled) {
      compiler.allowJs = true
      require.extensions['.js'] = originalJsHandler
      extensions.push('.js')
    }
    tsHandler = require.extensions['.ts']
    compiler.writeChildHookFile(options)
  },
  compileChanged: function (fileName) {
    var ext = path.extname(fileName)
    if (extensions.indexOf(ext) < 0) return
    try {
      var code = fs.readFileSync(fileName, 'utf-8')
      compiler.compile({
        code: code,
        compile: fileName,
        compiledPath: getCompiledPath(code, fileName, compiler.getCompiledDir())
      })
    } catch (e) {
      console.error(e)
    }
  },
  compile: function (params) {
    var fileName = params.compile
    var code = fs.readFileSync(fileName, 'utf-8')
    var compiledPath = params.compiledPath    
    function writeCompiled(code, filename) {
      fs.writeFileSync(compiledPath, code)
      fs.writeFileSync(compiledPath + '.done', '')
    }
    if (fs.existsSync(compiledPath)) {
      return
    }
    var m = {
      _compile: writeCompiled
    }
    tsHandler(m, fileName)
    try {
      m._compile(code, fileName)
    } catch (e) {
      console.error('Compilation error:', e)
      code = 'throw new Error("Unable to compile TypeScript");'
      writeCompiled(code)
    }
  }
}

module.exports = compiler