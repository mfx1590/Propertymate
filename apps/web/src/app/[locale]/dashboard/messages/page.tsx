'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../../../lib/api';
import { getSocket } from '../../../../lib/socket';
import { useAuth } from '../../../../lib/auth';

interface Convo {
  id: string;
  property: { id: string; titleI18n: { en?: string }; media: { url: string }[] } | null;
  myRole: string;
  anonymous: boolean;
  lastMessage: { body: string; createdAt: string } | null;
}
interface Msg {
  id: string;
  senderId: string;
  body: string;
  bodyScrubbed: boolean;
  createdAt: string;
}

export default function MessagesPage() {
  const t = useTranslations('chat');
  const { me } = useAuth();
  const [convos, setConvos] = useState<Convo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void apiGet<Convo[]>('/users/me/conversations').then((c) => {
      setConvos(c);
      if (c.length > 0) setActive((a) => a ?? c[0].id);
    });
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    setMessages(await apiGet<Msg[]>(`/conversations/${id}/messages`));
  }, []);

  const refreshConvos = useCallback(async () => {
    setConvos(await apiGet<Convo[]>('/users/me/conversations'));
  }, []);

  // realtime: join the active conversation room, append incoming messages live.
  // A slow 30s poll remains only as a reconnection safety net.
  useEffect(() => {
    if (!active) return;
    void loadMessages(active);

    const socket = getSocket();
    const onMessage = (m: Msg) => {
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    };
    if (socket) {
      socket.emit('conversation.join', active);
      socket.on('message', onMessage);
      socket.on('notify', () => void refreshConvos());
    }
    const fallback = setInterval(() => void loadMessages(active), 30000);

    return () => {
      clearInterval(fallback);
      if (socket) {
        socket.emit('conversation.leave', active);
        socket.off('message', onMessage);
        socket.off('notify');
      }
    };
  }, [active, loadMessages, refreshConvos]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = async () => {
    if (!active || !draft.trim()) return;
    setBusy(true);
    try {
      await apiPost(`/conversations/${active}/messages`, { message: draft });
      setDraft('');
      await loadMessages(active);
    } finally {
      setBusy(false);
    }
  };

  const activeConvo = convos.find((c) => c.id === active);

  return (
    <div className="flex h-[calc(100vh-6rem)] max-w-5xl gap-4">
      {/* conversation list */}
      <aside className="w-72 shrink-0 space-y-1 overflow-y-auto">
        <h1 className="mb-3 text-xl font-bold">{t('title')}</h1>
        {convos.length === 0 && <p className="text-sm text-gray-500">{t('empty')}</p>}
        {convos.map((c) => (
          <button
            key={c.id}
            onClick={() => setActive(c.id)}
            className={`flex w-full items-center gap-2 rounded-xl p-2 text-start ${active === c.id ? 'bg-brand-50' : 'hover:bg-gray-50'}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {c.property?.media[0] ? (
              <img src={c.property.media[0].url} alt="" className="h-10 w-12 rounded object-cover" />
            ) : (
              <span className="flex h-10 w-12 items-center justify-center rounded bg-gray-100">🏠</span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {c.property?.titleI18n.en ?? '—'}
                {c.anonymous && ' 🔒'}
              </span>
              <span className="block truncate text-xs text-gray-400">{c.lastMessage?.body ?? ''}</span>
            </span>
          </button>
        ))}
      </aside>

      {/* thread */}
      <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-gray-200">
        {activeConvo ? (
          <>
            <header className="border-b border-gray-100 p-3">
              <p className="font-semibold">{activeConvo.property?.titleI18n.en}</p>
              <p className="text-xs text-gray-400">
                {activeConvo.anonymous ? t('anonymousNote') : t('scrubNote')}
              </p>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {messages.map((m) => {
                const mine = m.senderId === me?.id;
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                        mine ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {m.body}
                      {m.bodyScrubbed && (
                        <p className={`mt-1 text-[10px] ${mine ? 'text-white/70' : 'text-gray-400'}`}>
                          ⚠ {t('scrubbedFlag')}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <footer className="flex gap-2 border-t border-gray-100 p-3">
              <input
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder={t('placeholder')}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
              />
              <button
                onClick={send}
                disabled={busy || !draft.trim()}
                className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {t('send')}
              </button>
            </footer>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-gray-400">{t('pickConversation')}</div>
        )}
      </section>
    </div>
  );
}
