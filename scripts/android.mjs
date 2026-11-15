/**
 * Builds the Android app (web UI + APK) with every tool cache on drive D (Gradle home, Android user
 * home), then runs the Kotlin unit tests.   npm run android
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const tools = process.env.ML_ANDROID_TOOLS ?? 'D:/androidtools';
const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME ?? `${tools}/jdk`,
  ANDROID_HOME: process.env.ANDROID_HOME ?? `${tools}/sdk`,
  GRADLE_USER_HOME: process.env.GRADLE_USER_HOME ?? `${tools}/gradle-home`,
  ANDROID_USER_HOME: process.env.ANDROID_USER_HOME ?? `${tools}/android-home`,
};
const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('node', ['scripts/build-data.mjs', '--if-missing'], root);
run('node', ['scripts/build-mobile.mjs'], root);
const gradlew = resolve(root, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
run(`"${gradlew}"`, ['assembleDebug', 'testDebugUnitTest', '--console=plain'], resolve(root, 'android'));
console.log('[android] APK:', resolve(root, 'android/app/build/outputs/apk/debug/app-debug.apk'));
