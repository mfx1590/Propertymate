/**
 * Server-rendered notification copy (Plan §6.6 "template registry, all i18n").
 *
 * The web app keeps its own in-app strings: an in-app row is one line under a
 * bell icon, whereas email needs a subject AND a body and push needs a short
 * title. Same event, genuinely different copy — so this is a sibling catalogue,
 * not a duplicate of the next-intl messages.
 *
 * WhatsApp deliberately has no free text: the Cloud API only accepts approved
 * template names outside a 24-hour session window, so `whatsappTemplate` names
 * the template and the body params are derived from the payload.
 */

export type Locale = 'en' | 'tr' | 'ru' | 'fa';

export const LOCALES: Locale[] = ['en', 'tr', 'ru', 'fa'];
export const DEFAULT_LOCALE: Locale = 'en';

interface Copy {
  /** email subject + push title */
  title: string;
  /** email body + push body */
  body: string;
}

interface TemplateDef {
  /** approved Meta Cloud API template name; absent = never sent over WhatsApp */
  whatsappTemplate?: string;
  /** which payload fields become the WhatsApp body params, in order */
  whatsappParams?: string[];
  copy: Record<Locale, Copy>;
}

const T = (
  en: Copy,
  tr: Copy,
  ru: Copy,
  fa: Copy,
  whatsapp?: { template: string; params: string[] },
): TemplateDef => ({
  whatsappTemplate: whatsapp?.template,
  whatsappParams: whatsapp?.params,
  copy: { en, tr, ru, fa },
});

export const NOTIFICATION_TEMPLATES: Record<string, TemplateDef> = {
  'verification.approved': T(
    { title: 'Your listing is verified', body: '“{title}” passed verification and is live.' },
    { title: 'İlanınız doğrulandı', body: '“{title}” doğrulamayı geçti ve yayında.' },
    { title: 'Объявление проверено', body: '«{title}» прошло проверку и опубликовано.' },
    { title: 'آگهی شما تأیید شد', body: '«{title}» تأیید شد و منتشر شده است.' },
  ),
  'verification.approved_private': T(
    { title: 'Your property is verified', body: '“{title}” is verified. Choose your agents in Find-my-agent to bring it to market.' },
    { title: 'Mülkünüz doğrulandı', body: '“{title}” doğrulandı. Pazara çıkarmak için Danışmanımı Bul’dan danışman seçin.' },
    { title: 'Объект проверен', body: '«{title}» проверен. Выберите агентов в «Найти агента», чтобы вывести его на рынок.' },
    { title: 'ملک شما تأیید شد', body: '«{title}» تأیید شد. برای عرضه به بازار از بخش یافتن مشاور، مشاور انتخاب کنید.' },
  ),
  'verification.rejected': T(
    { title: 'Documents need attention', body: 'Some documents for “{title}” were rejected. Re-upload only the flagged boxes.' },
    { title: 'Belgeler gözden geçirilmeli', body: '“{title}” için bazı belgeler reddedildi. Yalnızca işaretlenen kutuları yeniden yükleyin.' },
    { title: 'Требуются документы', body: 'Часть документов по «{title}» отклонена. Загрузите заново только отмеченные.' },
    { title: 'مدارک نیاز به بررسی دارند', body: 'برخی مدارک «{title}» رد شد. فقط موارد علامت‌خورده را دوباره بارگذاری کنید.' },
  ),
  'profile.verified': T(
    { title: 'Your profile is verified', body: 'Your {title} profile is verified — you can start listing.' },
    { title: 'Profiliniz doğrulandı', body: '{title} profiliniz doğrulandı — ilan vermeye başlayabilirsiniz.' },
    { title: 'Профиль проверен', body: 'Ваш профиль {title} проверен — можно размещать объявления.' },
    { title: 'نمایهٔ شما تأیید شد', body: 'نمایهٔ {title} شما تأیید شد — می‌توانید آگهی ثبت کنید.' },
  ),
  'profile.rejected': T(
    { title: 'Profile application rejected', body: 'Your {title} application was rejected. Check the document notes and re-submit.' },
    { title: 'Profil başvurusu reddedildi', body: '{title} başvurunuz reddedildi. Belge notlarını kontrol edip tekrar gönderin.' },
    { title: 'Заявка отклонена', body: 'Ваша заявка {title} отклонена. Проверьте замечания к документам и подайте снова.' },
    { title: 'درخواست نمایه رد شد', body: 'درخواست {title} شما رد شد. یادداشت‌های مدارک را بررسی و دوباره ارسال کنید.' },
  ),
  'availability.confirm_needed': T(
    { title: 'Confirm your listing is available', body: 'Please confirm “{title}” is still available, or it will be paused.' },
    { title: 'İlanınızın müsaitliğini onaylayın', body: '“{title}” hâlâ müsait mi onaylayın, aksi hâlde duraklatılacak.' },
    { title: 'Подтвердите доступность', body: 'Подтвердите, что «{title}» ещё доступен, иначе объявление будет приостановлено.' },
    { title: 'در دسترس بودن آگهی را تأیید کنید', body: 'لطفاً تأیید کنید «{title}» هنوز در دسترس است، وگرنه متوقف می‌شود.' },
    { template: 'availability_confirm', params: ['title'] },
  ),
  'availability.paused': T(
    { title: 'Your listing was paused', body: '“{title}” was paused because availability was not confirmed. Confirm to relist.' },
    { title: 'İlanınız duraklatıldı', body: 'Müsaitlik onaylanmadığı için “{title}” duraklatıldı. Onaylayınca tekrar yayınlanır.' },
    { title: 'Объявление приостановлено', body: '«{title}» приостановлено — доступность не подтверждена. Подтвердите для возврата.' },
    { title: 'آگهی شما متوقف شد', body: '«{title}» به دلیل تأیید نشدن در دسترس بودن متوقف شد. برای انتشار مجدد تأیید کنید.' },
    { template: 'availability_paused', params: ['title'] },
  ),
  'assignment.invited': T(
    { title: 'New mandate invitation', body: 'You were invited to work a property: “{title}”.' },
    { title: 'Yeni yetki daveti', body: 'Bir mülk için davet edildiniz: “{title}”.' },
    { title: 'Новое приглашение', body: 'Вас пригласили работать с объектом: «{title}».' },
    { title: 'دعوت جدید برای نمایندگی', body: 'برای کار روی یک ملک دعوت شدید: «{title}».' },
  ),
  'assignment.accepted': T(
    { title: 'An agent accepted', body: 'An agent accepted your property assignment.' },
    { title: 'Bir danışman kabul etti', body: 'Bir danışman mülk atamanızı kabul etti.' },
    { title: 'Агент принял', body: 'Агент принял назначение по вашему объекту.' },
    { title: 'مشاور پذیرفت', body: 'یک مشاور واگذاری ملک شما را پذیرفت.' },
  ),
  'assignment.rejected': T(
    { title: 'An agent declined', body: 'An agent declined your property assignment.' },
    { title: 'Bir danışman reddetti', body: 'Bir danışman mülk atamanızı reddetti.' },
    { title: 'Агент отказался', body: 'Агент отклонил назначение по вашему объекту.' },
    { title: 'مشاور نپذیرفت', body: 'یک مشاور واگذاری ملک شما را رد کرد.' },
  ),
  'assignment.published': T(
    { title: 'Your property is on the market', body: 'Your agent published “{title}”.' },
    { title: 'Mülkünüz pazarda', body: 'Danışmanınız “{title}” ilanını yayınladı.' },
    { title: 'Объект опубликован', body: 'Ваш агент опубликовал «{title}».' },
    { title: 'ملک شما در بازار است', body: 'مشاور شما «{title}» را منتشر کرد.' },
  ),
  'chat.new_inquiry': T(
    { title: 'New inquiry', body: 'You have a new inquiry about “{title}”.' },
    { title: 'Yeni talep', body: '“{title}” hakkında yeni bir talep var.' },
    { title: 'Новая заявка', body: 'Новая заявка по «{title}».' },
    { title: 'درخواست جدید', body: 'درخواست جدیدی دربارهٔ «{title}» دارید.' },
  ),
  'chat.new_message': T(
    { title: 'New message', body: 'You have a new message in your inbox.' },
    { title: 'Yeni mesaj', body: 'Gelen kutunuzda yeni bir mesaj var.' },
    { title: 'Новое сообщение', body: 'У вас новое сообщение.' },
    { title: 'پیام جدید', body: 'پیام جدیدی در صندوق شما دارید.' },
  ),
  'viewing.requested': T(
    { title: 'New viewing request', body: 'A viewing was requested for “{title}”.' },
    { title: 'Yeni görüntüleme talebi', body: '“{title}” için görüntüleme talep edildi.' },
    { title: 'Запрос на показ', body: 'Запрошен показ по «{title}».' },
    { title: 'درخواست بازدید جدید', body: 'برای «{title}» درخواست بازدید ثبت شد.' },
    { template: 'viewing_requested', params: ['title'] },
  ),
  'viewing.confirmed': T(
    { title: 'Viewing confirmed', body: 'Your viewing has been confirmed.' },
    { title: 'Görüntüleme onaylandı', body: 'Görüntüleme randevunuz onaylandı.' },
    { title: 'Показ подтверждён', body: 'Ваш показ подтверждён.' },
    { title: 'بازدید تأیید شد', body: 'بازدید شما تأیید شد.' },
    { template: 'viewing_confirmed', params: [] },
  ),
  'viewing.completed': T(
    { title: 'Viewing completed', body: 'A viewing was marked completed.' },
    { title: 'Görüntüleme tamamlandı', body: 'Bir görüntüleme tamamlandı olarak işaretlendi.' },
    { title: 'Показ завершён', body: 'Показ отмечен как состоявшийся.' },
    { title: 'بازدید انجام شد', body: 'یک بازدید انجام‌شده ثبت شد.' },
  ),
  'viewing.cancelled': T(
    { title: 'Viewing cancelled', body: 'A viewing was cancelled.' },
    { title: 'Görüntüleme iptal edildi', body: 'Bir görüntüleme iptal edildi.' },
    { title: 'Показ отменён', body: 'Показ был отменён.' },
    { title: 'بازدید لغو شد', body: 'یک بازدید لغو شد.' },
    { template: 'viewing_cancelled', params: [] },
  ),
  'viewing.no_show': T(
    { title: 'Viewing marked no-show', body: 'A viewing was marked as a no-show.' },
    { title: 'Görüntülemeye gelinmedi', body: 'Bir görüntüleme gelinmedi olarak işaretlendi.' },
    { title: 'Неявка на показ', body: 'Показ отмечен как неявка.' },
    { title: 'عدم حضور در بازدید', body: 'یک بازدید به‌عنوان عدم حضور ثبت شد.' },
  ),
  'offer.received': T(
    { title: 'New offer', body: 'You received a new offer on “{title}”.' },
    { title: 'Yeni teklif', body: '“{title}” için yeni bir teklif aldınız.' },
    { title: 'Новое предложение', body: 'Получено новое предложение по «{title}».' },
    { title: 'پیشنهاد جدید', body: 'برای «{title}» پیشنهاد جدیدی دریافت کردید.' },
    { template: 'offer_received', params: ['title'] },
  ),
  'offer.countered': T(
    { title: 'Counter-offer received', body: 'You received a counter-offer.' },
    { title: 'Karşı teklif', body: 'Bir karşı teklif aldınız.' },
    { title: 'Встречное предложение', body: 'Вы получили встречное предложение.' },
    { title: 'پیشنهاد متقابل', body: 'یک پیشنهاد متقابل دریافت کردید.' },
    { template: 'offer_countered', params: [] },
  ),
  'offer.accepted': T(
    { title: 'Your offer was accepted', body: 'Your offer was accepted — the deal room is open.' },
    { title: 'Teklifiniz kabul edildi', body: 'Teklifiniz kabul edildi — işlem odası açıldı.' },
    { title: 'Предложение принято', body: 'Ваше предложение принято — комната сделки открыта.' },
    { title: 'پیشنهاد شما پذیرفته شد', body: 'پیشنهاد شما پذیرفته شد — اتاق معامله باز است.' },
    { template: 'offer_accepted', params: [] },
  ),
  'offer.rejected': T(
    { title: 'Your offer was declined', body: 'Your offer was declined.' },
    { title: 'Teklifiniz reddedildi', body: 'Teklifiniz reddedildi.' },
    { title: 'Предложение отклонено', body: 'Ваше предложение отклонено.' },
    { title: 'پیشنهاد شما رد شد', body: 'پیشنهاد شما رد شد.' },
  ),
  'deal.created': T(
    { title: 'Deal room opened', body: 'A deal room was opened for “{title}”.' },
    { title: 'İşlem odası açıldı', body: '“{title}” için bir işlem odası açıldı.' },
    { title: 'Открыта сделка', body: 'Открыта комната сделки по «{title}».' },
    { title: 'اتاق معامله باز شد', body: 'برای «{title}» اتاق معامله باز شد.' },
  ),
  'deal.stage_advanced': T(
    { title: 'Your deal moved forward', body: 'Your deal advanced to the next stage.' },
    { title: 'İşleminiz ilerledi', body: 'İşleminiz bir sonraki aşamaya geçti.' },
    { title: 'Сделка продвинулась', body: 'Сделка перешла к следующему этапу.' },
    { title: 'معاملهٔ شما پیش رفت', body: 'معاملهٔ شما به مرحلهٔ بعد رسید.' },
  ),
  'deal.completed': T(
    { title: 'Your deal is complete', body: 'Your deal is complete. You can now rate the other party.' },
    { title: 'İşleminiz tamamlandı', body: 'İşleminiz tamamlandı. Artık karşı tarafı puanlayabilirsiniz.' },
    { title: 'Сделка завершена', body: 'Сделка завершена. Теперь вы можете оценить контрагента.' },
    { title: 'معاملهٔ شما کامل شد', body: 'معاملهٔ شما کامل شد. اکنون می‌توانید طرف مقابل را امتیاز دهید.' },
  ),
  'project.update_published': T(
    { title: 'Construction update', body: 'New progress update on your project: {title}.' },
    { title: 'İnşaat güncellemesi', body: 'Projenizde yeni ilerleme güncellemesi: {title}.' },
    { title: 'Ход строительства', body: 'Новое обновление по вашему проекту: {title}.' },
    { title: 'به‌روزرسانی ساخت', body: 'به‌روزرسانی جدید پروژهٔ شما: {title}.' },
  ),

  // §13.2 moderation. These go to two different people: `report_*` to the
  // profile owner who reported, `review_removed` / `warning` / `banned` to the
  // reviewer who wrote it. None of them quote the removed text back.
  'moderation.report_upheld': T(
    {
      title: 'The review you reported was removed',
      body: 'An admin removed the comment on that review. The rating itself still counts towards your score.',
    },
    {
      title: 'Bildirdiğiniz yorum kaldırıldı',
      body: 'Bir yönetici o değerlendirmedeki yorumu kaldırdı. Puanın kendisi ortalamanıza sayılmaya devam ediyor.',
    },
    {
      title: 'Отмеченный вами отзыв удалён',
      body: 'Администратор удалил комментарий к этому отзыву. Сама оценка по-прежнему учитывается в вашем рейтинге.',
    },
    {
      title: 'نظری که گزارش کردید حذف شد',
      body: 'یکی از مدیران متن آن نظر را حذف کرد. خود امتیاز همچنان در میانگین شما حساب می‌شود.',
    },
  ),
  'moderation.report_dismissed': T(
    {
      title: 'The review you reported stands',
      body: 'An admin reviewed your report and found nothing that breaks the rules, so the review stays as written.',
    },
    {
      title: 'Bildirdiğiniz yorum kaldı',
      body: 'Bir yönetici bildiriminizi inceledi ve kuralları ihlal eden bir şey bulmadı; değerlendirme yazıldığı gibi kalıyor.',
    },
    {
      title: 'Отзыв, на который вы пожаловались, остаётся',
      body: 'Администратор рассмотрел жалобу и не нашёл нарушений, поэтому отзыв остаётся без изменений.',
    },
    {
      title: 'نظری که گزارش کردید باقی می‌ماند',
      body: 'یکی از مدیران گزارش شما را بررسی کرد و موردی خلاف قوانین نیافت؛ بنابراین نظر به همان شکل باقی می‌ماند.',
    },
  ),
  'moderation.review_removed': T(
    {
      title: 'Your review comment was removed',
      body: 'An admin removed the comment you left on a completed deal. Reason: {reason}',
    },
    {
      title: 'Değerlendirme yorumunuz kaldırıldı',
      body: 'Bir yönetici, tamamlanmış bir işlem için yazdığınız yorumu kaldırdı. Gerekçe: {reason}',
    },
    {
      title: 'Ваш комментарий к отзыву удалён',
      body: 'Администратор удалил комментарий, оставленный вами по завершённой сделке. Причина: {reason}',
    },
    {
      title: 'متن نظر شما حذف شد',
      body: 'یکی از مدیران متنی را که برای یک معاملهٔ تکمیل‌شده نوشته بودید حذف کرد. دلیل: {reason}',
    },
  ),
  'moderation.warning': T(
    {
      title: 'Warning on your account',
      body: 'This is warning {count} of {limit}. Reaching {limit} suspends your account permanently. Reason: {reason}',
    },
    {
      title: 'Hesabınız hakkında uyarı',
      body: 'Bu, {limit} uyarıdan {count}. uyarıdır. {limit} uyarıya ulaşmak hesabınızı kalıcı olarak kapatır. Gerekçe: {reason}',
    },
    {
      title: 'Предупреждение по вашему аккаунту',
      body: 'Это предупреждение {count} из {limit}. При {limit} аккаунт закрывается навсегда. Причина: {reason}',
    },
    {
      title: 'اخطار برای حساب شما',
      body: 'این اخطار {count} از {limit} است. رسیدن به {limit} اخطار حساب شما را برای همیشه می‌بندد. دلیل: {reason}',
    },
  ),
  'moderation.banned': T(
    {
      title: 'Your account has been closed',
      body: 'After {count} warnings your account has been permanently closed and you have been signed out of every device.',
    },
    {
      title: 'Hesabınız kapatıldı',
      body: '{count} uyarıdan sonra hesabınız kalıcı olarak kapatıldı ve tüm cihazlardan çıkış yapıldı.',
    },
    {
      title: 'Ваш аккаунт закрыт',
      body: 'После {count} предупреждений ваш аккаунт закрыт навсегда, и вы вышли из системы на всех устройствах.',
    },
    {
      title: 'حساب شما بسته شد',
      body: 'پس از {count} اخطار، حساب شما برای همیشه بسته شد و از همهٔ دستگاه‌ها خارج شدید.',
    },
  ),

  // §6.1 discovery alerts. These are the only notifications a user receives
  // without having done something first, so both name the saved search or
  // property that caused them — an unexplained nudge is what gets muted.
  'discovery.new_matches': T(
    {
      title: '{count} new verified listings',
      body: '{count} new listings match “{name}”. Every one has already passed a document check.',
    },
    {
      title: '{count} yeni doğrulanmış ilan',
      body: '“{name}” aramanıza uyan {count} yeni ilan var. Hepsi belge kontrolünden geçti.',
    },
    {
      title: '{count} новых проверенных объявлений',
      body: 'Под «{name}» подходят {count} новых объявления. Все уже прошли проверку документов.',
    },
    {
      title: '{count} آگهی تأییدشدهٔ تازه',
      body: '{count} آگهی تازه با «{name}» هم‌خوانی دارد. همهٔ آن‌ها بررسی مدارک را گذرانده‌اند.',
    },
  ),
  'discovery.price_drop': T(
    {
      title: 'Price reduced on a saved property',
      body: '“{title}” dropped {pct}% — from £{oldPrice} to £{newPrice}.',
    },
    {
      title: 'Kaydettiğiniz mülkün fiyatı düştü',
      body: '“{title}” %{pct} düştü — £{oldPrice} yerine £{newPrice}.',
    },
    {
      title: 'Цена на сохранённый объект снижена',
      body: '«{title}» подешевел на {pct}% — с £{oldPrice} до £{newPrice}.',
    },
    {
      title: 'قیمت ملکی که ذخیره کرده‌اید کم شد',
      body: '«{title}» ‏{pct}٪ کاهش یافت — از £{oldPrice} به £{newPrice}.',
    },
  ),
  // ── §10.2 lawyer marketplace ──────────────────────────────────────
  // Every placeholder here is locale-agnostic on purpose: a name, a property
  // title, a number, a currency code. The step-20 bug was an English party
  // label baked into a payload that is rendered per-recipient afterwards, so
  // the stage name and the "acting for the buyer" side are deliberately NOT
  // interpolated — both live in the deal room, already translated.
  'legal.quote_requested': T(
    {
      title: 'New quote request',
      body: 'You have been asked to quote for the legal work on “{title}”.',
    },
    {
      title: 'Yeni teklif talebi',
      body: '“{title}” için hukuki iş bedelini bildirmeniz istendi.',
    },
    {
      title: 'Новый запрос на смету',
      body: 'Вас просят оценить юридическую работу по «{title}».',
    },
    {
      title: 'درخواست تازهٔ برآورد هزینه',
      body: 'از شما خواسته شده برای کار حقوقی «{title}» هزینه اعلام کنید.',
    },
  ),
  'legal.quote_received': T(
    {
      title: 'A lawyer has quoted',
      body: '{lawyer} quoted {amount} {currency} for the legal work on “{title}”.',
    },
    {
      title: 'Bir avukat teklif verdi',
      body: '{lawyer}, “{title}” için hukuki iş bedelini {amount} {currency} olarak bildirdi.',
    },
    {
      title: 'Юрист прислал смету',
      body: '{lawyer} оценил юридическую работу по «{title}» в {amount} {currency}.',
    },
    {
      title: 'یک وکیل هزینه اعلام کرد',
      body: '{lawyer} هزینهٔ کار حقوقی «{title}» را {amount} {currency} اعلام کرد.',
    },
  ),
  'legal.quote_declined': T(
    {
      title: 'A lawyer declined',
      body: '{lawyer} is not taking on the legal work for “{title}”. Your other requests are unaffected.',
    },
    {
      title: 'Bir avukat talebi geri çevirdi',
      body: '{lawyer}, “{title}” için hukuki işi üstlenmiyor. Diğer talepleriniz etkilenmedi.',
    },
    {
      title: 'Юрист отказался',
      body: '{lawyer} не берётся за юридическую работу по «{title}». Остальные ваши запросы в силе.',
    },
    {
      title: 'یک وکیل درخواست را نپذیرفت',
      body: '{lawyer} کار حقوقی «{title}» را نمی‌پذیرد. درخواست‌های دیگر شما به قوت خود باقی است.',
    },
  ),
  'legal.engagement_accepted': T(
    {
      title: 'Your quote was accepted',
      body: 'You are now acting on “{title}” and have access to the deal room.',
    },
    {
      title: 'Teklifiniz kabul edildi',
      body: 'Artık “{title}” işini yürütüyorsunuz ve işlem odasına erişiminiz var.',
    },
    {
      title: 'Вашу смету приняли',
      body: 'Вы ведёте сделку по «{title}» и получили доступ к комнате сделки.',
    },
    {
      title: 'برآورد شما پذیرفته شد',
      body: 'اکنون کار «{title}» را بر عهده دارید و به اتاق معامله دسترسی دارید.',
    },
  ),
  'legal.request_withdrawn': T(
    {
      title: 'A quote request was withdrawn',
      body: 'The request to quote on “{title}” has been withdrawn.',
    },
    {
      title: 'Bir teklif talebi geri çekildi',
      body: '“{title}” için fiyat teklifi talebi geri çekildi.',
    },
    {
      title: 'Запрос на смету отозван',
      body: 'Запрос на оценку работы по «{title}» отозван.',
    },
    {
      title: 'یک درخواست برآورد پس گرفته شد',
      body: 'درخواست اعلام هزینه برای «{title}» پس گرفته شد.',
    },
  ),
  'legal.lawyer_joined': T(
    {
      title: 'A lawyer joined the deal',
      body: '{lawyer} has joined the deal room for “{title}”.',
    },
    {
      title: 'İşleme bir avukat katıldı',
      body: '{lawyer}, “{title}” işlem odasına katıldı.',
    },
    {
      title: 'К сделке подключился юрист',
      body: '{lawyer} присоединился к комнате сделки по «{title}».',
    },
    {
      title: 'یک وکیل به معامله پیوست',
      body: '{lawyer} به اتاق معاملهٔ «{title}» پیوست.',
    },
  ),
};

/** `{placeholder}` interpolation against the notification payload. */
export function interpolate(text: string, payload: Record<string, unknown> = {}): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = payload[key];
    return value === undefined || value === null ? whole : String(value);
  });
}

export function renderTemplate(
  templateKey: string,
  locale: string | null | undefined,
  payload: Record<string, unknown> = {},
): { title: string; body: string; def: TemplateDef | null } {
  const def = NOTIFICATION_TEMPLATES[templateKey];
  if (!def) {
    // An unregistered key still delivers in-app; outside channels get the key
    // rather than silence, so a missing template is visible, not swallowed.
    return { title: templateKey, body: templateKey, def: null };
  }
  const lang = (LOCALES as string[]).includes(locale ?? '') ? (locale as Locale) : DEFAULT_LOCALE;
  const copy = def.copy[lang];
  return {
    title: interpolate(copy.title, payload),
    body: interpolate(copy.body, payload),
    def,
  };
}
