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
