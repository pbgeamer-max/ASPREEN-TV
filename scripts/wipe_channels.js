/**
 * ASPREEN TV - Wipe All Channels Tool
 * مسح جميع القنوات بالكامل من قاعدة البيانات للبدء من جديد
 */

const { getPool, initDatabase } = require('../apps/api/dist/db');

async function main() {
  console.log('===================================================');
  console.log('        ASPREEN TV - حذف جميع القنوات بالكامل       ');
  console.log('===================================================\n');

  try {
    await initDatabase();
    const pool = getPool();
    if (!pool) {
      console.log('⚠️ لم يتم العثور على اتصال قاعدة بيانات نشط (PostgreSQL).');
      process.exit(0);
    }

    const countRes = await pool.query('SELECT COUNT(*) as cnt FROM channels');
    const totalBefore = parseInt(countRes.rows[0]?.cnt || 0, 10);
    console.log(`📊 عدد القنوات الموجودة حالياً في قاعدة البيانات: ${totalBefore} قناة.`);

    if (totalBefore === 0) {
      console.log('✅ جدول القنوات فارغ بالفعل.');
      process.exit(0);
    }

    console.log('🗑️ جاري حذف جميع القنوات...');
    const deleteRes = await pool.query('DELETE FROM channels');
    console.log(`✅ تم حذف جميع الـ ${deleteRes.rowCount} قناة بنجاح تام!`);
    console.log('✨ النظام جاهز الآن لعملية الصيد النظيفة والمرتبة.\n');
  } catch (err) {
    console.error('❌ خطأ أثناء حذف القنوات:', err.message);
    process.exit(1);
  }
}

main();
