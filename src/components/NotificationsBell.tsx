import { Bell, MessageSquare, CheckCheck } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/hooks/useNotifications';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useState } from 'react';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

interface NotificationsBellProps {
  collapsed?: boolean;
}

export function NotificationsBell({ collapsed = false }: NotificationsBellProps) {
  const { notifications, unreadCount, realtimeConnected, markAsRead, markAllAsRead, refetch } = useNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) refetch();
  };

  const handleOpen = (id: string, conversationId: string | null) => {
    markAsRead(id);
    if (conversationId) {
      navigate(`/chat?conversation=${conversationId}`);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="relative flex items-center gap-3 rounded-lg px-2 py-2 text-foreground/80 hover:bg-muted/50 hover:text-foreground transition-colors w-full"
          aria-label="Notificações"
        >
          <div className="relative w-5 h-5 flex items-center justify-center flex-shrink-0">
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-background">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm whitespace-nowrap"
            >
              Notificações
            </motion.span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="w-96 p-0 bg-slate-900 border-slate-800"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-100">Notificações</h3>
            <span
              className={`inline-flex items-center gap-1 text-[10px] ${
                realtimeConnected ? 'text-emerald-400' : 'text-slate-500'
              }`}
              title={realtimeConnected ? 'Conectado em tempo real' : 'Sincronizando...'}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  realtimeConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                }`}
              />
              {realtimeConnected ? 'ao vivo' : 'offline'}
            </span>
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllAsRead}
              className="text-xs text-slate-400 hover:text-white h-7"
            >
              <CheckCheck className="w-3.5 h-3.5 mr-1" />
              Marcar todas
            </Button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
              Nenhuma notificação
            </div>
          ) : (
            notifications.map((n) => {
              const isUrgent = n.type === 'handoff_urgent';
              return (
                <button
                  key={n.id}
                  onClick={() => handleOpen(n.id, n.conversation_id)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-800/50 hover:bg-slate-800/40 transition-colors ${
                    !n.is_read ? 'bg-slate-800/20' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                        !n.is_read
                          ? isUrgent
                            ? 'bg-rose-500 animate-pulse'
                            : 'bg-cyan-400'
                          : 'bg-slate-700'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p
                          className={`text-sm truncate ${
                            !n.is_read ? 'font-semibold text-slate-100' : 'text-slate-300'
                          }`}
                        >
                          {n.title}
                        </p>
                        <span className="text-[10px] text-slate-500 flex-shrink-0">
                          {timeAgo(n.created_at)}
                        </span>
                      </div>
                      {n.body && (
                        <p className="text-xs text-slate-400 line-clamp-2 whitespace-pre-line">
                          {n.body}
                        </p>
                      )}
                      {n.conversation_id && (
                        <div className="flex items-center gap-1 mt-1.5 text-[11px] text-cyan-400">
                          <MessageSquare className="w-3 h-3" />
                          Abrir conversa
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default NotificationsBell;
