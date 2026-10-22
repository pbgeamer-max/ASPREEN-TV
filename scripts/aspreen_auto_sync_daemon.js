/**
 * =============================================================================
 *          ASPREEN TV ▸ 24/7 LIVE CHANNELS AUTO-SYNC & HEALTH SUPERVISOR
 *       محرك المزامنة التلقائية ومراقبة جودة قنوات البث المباشر (yacine.website)
 * =============================================================================
 * 1. يتحقق تلقائياً من روابط قنوات yacine.website وتحديثها دورياً.
 * 2. يضمن عدم انقطاع البث وتوفر روابط البث الثابتة السلسة بدون تقطيع.
 * 3. يراقب خادم البروكسي الداخلي (Stream Proxy Daemon) لضمان استقرار البث بنسبة 100%.
 * =============================================================================
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHANNELS_PATH = path.join(__dirname, '..', 'channels.json');
const HARVEST_SCRIPT = path.join(__dirname, 'harvest_yacine_channels.py');
const SENTINEL_SCRIPT = path.join(__dirname, 'aspreen_multi_server_sentinel.py');

function log(msg) {
  const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[ChannelsSyncDaemon ${time}] ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runScript(scriptPath, desc) {
  return new Promise((resolve) => {
    log(`🔄 ${desc}...`);
    const pyBin = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
    const py = spawn(pyBin, [scriptPath], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
    });

    py.on('close', (code) => {
      log(`✅ اكتمل ${desc} (رمز: ${code})`);
      resolve();
    });

    py.on('error', (err) => {
      log(`❌ خطأ في تشغيل ${desc}: ${err.message}`);
      resolve();
    });
  });
}

function runMultiServerSentinel() {
  return runScript(SENTINEL_SCRIPT, 'محرك مراقبة البث الذكي والسيرفرات المتعددة');
}


async function verifyChannelsHealth() {
  if (!fs.existsSync(CHANNELS_PATH)) {
    log('⚠️ ملف channels.json غير موجود.');
    return;
  }

  try {
    const raw = fs.readFileSync(CHANNELS_PATH, 'utf8');
    const channels = JSON.parse(raw);
    log(`📊 إجمالي القنوات المراقبة: ${channels.length} قناة`);
  } catch (err) {
    log(`⚠️ خطأ في قراءة ملف channels.json: ${err.message}`);
  }
}

async function mainLoop() {
  log('🚀 تم تشغيل محرك المراقبة وفحص استقرار سيرفرات البث 24/7');
  
  // Initial check
  await verifyChannelsHealth();

  // Periodic loop every 30 minutes
  const SYNC_INTERVAL_MS = 30 * 60 * 1000;
  while (true) {
    await sleep(SYNC_INTERVAL_MS);
    try {
      await runMultiServerSentinel();
    } catch (err) {
      log(`❌ خطأ غير متوقع أثناء المراقبة الدورية: ${err.message}`);
    }
  }

}

if (require.main === module) {
  mainLoop().catch((err) => {
    log(`❌ خطأ قاتل في المشرف: ${err.message}`);
  });
}

module.exports = { verifyChannelsHealth };
