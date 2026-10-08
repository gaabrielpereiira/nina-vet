import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Play a short two-tone chime via Web Audio API (no asset needed).
// Wrapped in try/catch — autoplay policies may block until first user gesture.
let _audioCtx: AudioContext | null = null;
function playHandoffChime(urgent = false) {
  try {
    const AC = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AC) return;
    if (!_audioCtx) _audioCtx = new AC();
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const tones = urgent ? [880, 1175, 880] : [660, 990];
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.18;
      const dur = 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(urgent ? 0.35 : 0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    });
  } catch (err) {
    console.debug('[Notifications] chime failed (likely autoplay policy):', err);
  }
}


export type PlatformNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  conversation_id: string | null;
  contact_id: string | null;
  metadata: Record<string, any> | null;
  is_read: boolean;
  created_at: string;
};

export function useNotifications() {
  const [notifications, setNotifications] = useState<PlatformNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const realtimeConnectedRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const fetchNotifications = useCallback(async () => {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[Notifications] Fetch error:', error);
      setLoading(false);
      return;
    }
    const list = (data || []) as PlatformNotification[];
    list.forEach((n) => seenIdsRef.current.add(n.id));
    const unread = list.filter((n) => !n.is_read).length;
    console.info(`[Notifications] fetched ${list.length}, unread ${unread}`);
    setNotifications(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchNotifications();

    // Unique channel name to avoid collisions across mounts
    const channelName = `notifications-feed-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const n = payload.new as PlatformNotification;
          if (seenIdsRef.current.has(n.id)) return;
          seenIdsRef.current.add(n.id);
          console.info('[Notifications] 🔔 INSERT:', n.title);
          setNotifications((prev) => [n, ...prev].slice(0, 50));
          if (n.type === 'handoff_urgent' || n.type === 'handoff_requested') {
            playHandoffChime(n.type === 'handoff_urgent');
          }
          toast(n.title, { description: n.body || undefined });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications' },
        (payload) => {
          const n = payload.new as PlatformNotification;
          setNotifications((prev) => prev.map((x) => (x.id === n.id ? n : x)));
        }
      )
      .subscribe((status) => {
        console.info('[Notifications] channel status:', status);
        const connected = status === 'SUBSCRIBED';
        realtimeConnectedRef.current = connected;
        setRealtimeConnected(connected);
      });

    // Polling fallback every 30s, but only while realtime isn't connected
    const pollInterval = setInterval(() => {
      if (!realtimeConnectedRef.current) fetchNotifications();
    }, 30000);

    return () => {
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [fetchNotifications]);

  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  }, []);

  const markAllAsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return {
    notifications,
    loading,
    unreadCount,
    realtimeConnected,
    markAsRead,
    markAllAsRead,
    refetch: fetchNotifications,
  };
}
