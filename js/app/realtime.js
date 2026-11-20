/**
 * Vira-7 — Tempo real.
 *
 * Com o Supabase, cada sala usa um canal do Supabase Realtime que entrega:
 *   - mudanças na sala e nos participantes (Postgres Changes, filtradas pelo RLS);
 *   - cada evento da partida, assim que o servidor grava (Postgres Changes);
 *   - quem está conectado agora (Presence).
 *
 * No modo de desenvolvimento local não há Supabase: o módulo avisa a tela em
 * intervalos curtos e ela consulta a API. As telas usam a mesma interface nos dois casos.
 */
((F7) => {
  'use strict';

  const POLL_MS = 1500;

  const Realtime = {
    get live() {
      return !!(F7.Auth && F7.Auth.client);
    },

    /**
     * Entra no canal de uma sala.
     * @param {{
     *   roomId: string, code: string, userId: string,
     *   onRoomChange: () => void,            algo mudou na sala: recarregar
     *   onGameEvent: (event: object) => void, novo evento de partida
     *   onPresence: (onlineIds: Set<string>) => void,
     *   onStatus: (status: 'connecting'|'online'|'offline'|'polling') => void,
     * }} handlers
     * @returns {{ leave: () => void }}
     */
    joinRoom({ roomId, code, userId, onRoomChange, onGameEvent, onPresence, onStatus }) {
      if (!this.live) {
        onStatus('polling');
        const timer = setInterval(onRoomChange, POLL_MS);
        return { leave: () => clearInterval(timer) };
      }

      const client = F7.Auth.client;
      onStatus('connecting');
      const channel = client.channel(`room:${code}`, { config: { presence: { key: userId } } });

      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, onRoomChange)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, onRoomChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'room_spectators', filter: `room_id=eq.${roomId}` }, onRoomChange)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_events', filter: `room_id=eq.${roomId}` }, (change) => {
          const row = change.new;
          onGameEvent({ seq: row.seq, type: row.type, payload: row.payload, state: row.state, gameId: row.game_id });
        })
        .on('presence', { event: 'sync' }, () => {
          onPresence(new Set(Object.keys(channel.presenceState())));
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            onStatus('online');
            await channel.track({ user_id: userId, online_at: new Date().toISOString() });
            // Ao (re)conectar, recarrega para não perder nada que mudou enquanto isso.
            onRoomChange();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            onStatus('offline');
          }
        });

      return { leave: () => client.removeChannel(channel) };
    },

    /** Avisa quando a lista de salas públicas muda. */
    watchPublicRooms(onChange) {
      if (!this.live) {
        const timer = setInterval(onChange, 4000);
        return { stop: () => clearInterval(timer) };
      }
      const client = F7.Auth.client;
      const channel = client
        .channel('public-rooms')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, onChange)
        .subscribe();
      // A política de segurança só entrega o evento enquanto a sala continua pública e aberta:
      // quando ela começa ou fecha, o aviso não chega. A consulta periódica tira a sala velha da lista.
      const timer = setInterval(() => document.visibilityState === 'visible' && onChange(), 15000);
      return { stop: () => { clearInterval(timer); client.removeChannel(channel); } };
    },
  };

  F7.Realtime = Realtime;
})(globalThis.F7 = globalThis.F7 || {});
