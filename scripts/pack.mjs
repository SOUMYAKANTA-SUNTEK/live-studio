// Builds the Windows app into dist/ (used by the release workflow).
import { packager } from '@electron/packager';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const paths = await packager({
  dir: '.',
  name: 'Live Studio',
  platform: 'win32',
  arch: 'x64',
  out: 'dist',
  overwrite: true,
  asar: { unpack: '**/ffmpeg.exe' },
  appVersion: pkg.version,
  ignore: [/^\/dist/, /^\/scripts/, /^\/\.github/, /^\/data\/state\.json/, /\.bat$/],
  win32metadata: { CompanyName: 'Live Studio', ProductName: 'Live Studio', FileDescription: 'Live Studio' },
});
console.log(paths);
