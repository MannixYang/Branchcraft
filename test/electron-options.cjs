const path = require('node:path');
function electronOptions(profile) {
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  return {
    env,
    executablePath: env.BRANCHCRAFT_EXE || require('electron'),
    args: [...(env.BRANCHCRAFT_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
      ...(env.BRANCHCRAFT_EXE ? [] : [path.resolve(__dirname, '..')]), '--user-data-dir=' + profile],
    timeout: 30000
  };
}
module.exports = {electronOptions};
