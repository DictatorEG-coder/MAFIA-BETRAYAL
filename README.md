# MAFIA: BETRAYAL

لعبة استنتاج اجتماعي وخيانة داخل مجموعات Telegram، تدور أحداثها في مدينة **الغُراب**.

## التقنية
- Cloudflare Workers: استقبال Telegram Webhook
- Cloudflare Durable Objects: حالة مستقلة ومتسلسلة لكل غرفة
- Cloudflare D1: حفظ الغرف واللاعبين وسجل الجولات
- JavaScript ES Modules
- Node.js built-in test runner

## ما يعمل في النواة الحالية
- إنشاء غرفة والانضمام والمغادرة، من 5 إلى 10 لاعبين
- صلاحية بدء اللعبة وإدارة المراحل لقائد الغرفة
- فحص توفر الرسائل الخاصة قبل بدء توزيع الأدوار
- توزيع الأدوار وإرسالها سرًا، مع إرسال أسماء حلفاء المافيا للمافيا فقط
- قائمة لاعبين مرقمة دون كشف أدوارهم
- أفعال ليلية: هجوم المافيا المنسق، الحماية، والتحقيق
- الترشيح، اختيار المتهم، والتصويت السري لصالح المتهم فقط
- عدم كشف أدوار المقصيين حتى نهاية اللعبة
- شروط فوز أولية وإظهار كشف الأدوار عند النهاية
- إعادة استخدام الغرفة في جولة جديدة
- حفظ بيانات الغرف واللاعبين والجولات في D1
- Webhook secret validation وD1 update deduplication وDurable Object Alarms
- اختبارات تلقائية لمنطق الأدوار والتصويت والليل والغرف والأمان

## أوامر Telegram
```
/mafia       إنشاء غرفة
/join        الانضمام
/leave       المغادرة قبل بدء اللعبة
/startgame   بدء اللعبة (قائد الغرفة)
/players     قائمة اللاعبين وأرقامهم
/status      حالة الغرفة
/attack N    اختيار هدف هجوم المافيا
/protect N   حماية لاعب
/investigate N  فحص لاعب
/nominate N  ترشيح لاعب
/defendant   اختيار المتهم (قائد الغرفة)
/openvote    فتح التصويت (قائد الغرفة)
/vote N      التصويت للمتهم
/finishvote  إنهاء التصويت (قائد الغرفة)
/resolve     حسم الليل (قائد الغرفة)
/newgame     فتح جولة جديدة بعد انتهاء السابقة
/rules       القواعد والأوامر
```

تُستخدم أرقام اللاعبين الظاهرة في `/players` بدل نشر Telegram IDs.

## التحقق محليًا
يتطلب Node.js 20 أو أحدث:
```sh
npm install
npm test
npm run check
```

## إعداد Cloudflare
1. أنشئ قاعدة D1 باسم `mafia-betrayal`.
2. ضع معرّفها الحقيقي مكان `REPLACE_WITH_D1_DATABASE_ID` في `wrangler.toml`.
3. طبّق الترحيلات: `npx wrangler d1 migrations apply mafia-betrayal --remote`.
4. أضف الأسرار باستخدام `npx wrangler secret put TELEGRAM_BOT_TOKEN` و`npx wrangler secret put TELEGRAM_WEBHOOK_SECRET`.
5. انشر باستخدام `npx wrangler deploy`.
6. اضبط Telegram webhook على `https://<worker-subdomain>/telegram/webhook` مع secret token نفسه.

## ما لم يكتمل بعد
هذه نسخة تطوير أولية وليست جاهزة للنشر العام. ما زالت هناك حاجة إلى:
- ربط كل انتقال بجدول زمني آلي كامل واستعادة المرحلة بعد انتهاء Alarm
- تفعيل قدرات الأدوار المتبقية، ومهمات المستقلين والاقتصاد والأحداث
- تحسين معالجة انقطاع اللاعبين وفشل إرسال الرسائل بعد بدء الجولة
- إضافة اختبارات محاكاة توازن آلاف الجولات
- تشغيل CI والتحقق من نتائج الاختبارات على GitHub قبل النشر

لا تضع أي Bot Token أو Cloudflare secret في المستودع.
