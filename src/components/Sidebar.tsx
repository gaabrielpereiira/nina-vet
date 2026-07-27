import React, { useState } from 'react';
import { LayoutDashboard, MessageSquare, Users, Settings as SettingsIcon, LogOut, ShieldCheck, Calendar, Kanban } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { useAuth } from '@/hooks/useAuth';
import { Sidebar, SidebarBody, SidebarLink, useSidebar } from '@/components/ui/sidebar';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import viaIcon from '@/assets/icon-via.png';
import viaLogoWhite from '@/assets/logo-via-white.png';

const menuItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'pipeline', label: 'Pipeline', icon: Kanban },
  { id: 'chat', label: 'Chat Ao Vivo', icon: MessageSquare },
  { id: 'contacts', label: 'Contatos', icon: Users },
  { id: 'scheduling', label: 'Agendamentos', icon: Calendar },
  { id: 'team', label: 'Equipe', icon: ShieldCheck },
  { id: 'settings', label: 'Configurações', icon: SettingsIcon },
];

const Logo = ({ companyName }: { companyName: string }) => {
  return (
    <Link to="/dashboard" className="flex items-center space-x-3 py-1">
      <div className="relative w-10 h-10 flex items-center justify-center flex-shrink-0">
        <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full" />
        <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20 p-1.5">
          <img src={viaIcon} alt="Logo" className="w-full h-full object-contain" />
        </div>
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="flex flex-col overflow-hidden"
      >
        <span className="font-bold text-lg tracking-tight text-foreground whitespace-nowrap">{companyName || 'Minha Empresa'}</span>
        <span className="text-[10px] uppercase tracking-wider text-primary font-semibold">Workspace</span>
      </motion.div>
    </Link>
  );
};

const LogoIcon = () => {
  return (
    <Link to="/dashboard" className="flex items-center py-1">
      <div className="relative w-10 h-10 flex items-center justify-center flex-shrink-0">
        <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full" />
        <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20 p-1.5">
          <img src={viaIcon} alt="Logo" className="w-full h-full object-contain" />
        </div>
      </div>
    </Link>
  );
};

const SidebarContent = () => {
  const { companyName } = useCompanySettings();
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname.substring(1) || 'dashboard';
  const { open, setOpen } = useSidebar();

  const links = menuItems.map(item => ({
    label: item.label,
    href: `/${item.id}`,
    icon: <item.icon className="h-5 w-5" />,
  }));

  const handleLogout = async () => {
    try {
      await signOut();
      toast.success('Logout realizado com sucesso');
      navigate('/auth', { replace: true });
    } catch (error) {
      toast.error('Erro ao fazer logout');
    }
  };

  // Get user initials
  const getUserInitials = () => {
    if (!user?.email) return 'US';
    const email = user.email;
    return email.substring(0, 2).toUpperCase();
  };

  // Get display name
  const getDisplayName = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name;
    }
    return 'Usuário';
  };

  return (
    <>
      <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mb-6">
          {open ? <Logo companyName={companyName} /> : <LogoIcon />}
        </div>
        
        <nav className="flex flex-col gap-1.5">
          {links.map((link, idx) => (
            <SidebarLink
              key={idx}
              link={link}
              isActive={currentPath.startsWith(link.href.slice(1))}
            />
          ))}
        </nav>
      </div>

      {/* VIA Logo - Footer */}
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="py-4 flex justify-center"
        >
          <img 
            src={viaLogoWhite} 
            alt="VIA" 
            className="h-6 opacity-60 hover:opacity-100 transition-opacity"
          />
        </motion.div>
      )}

      {/* User Footer */}
      <div className="border-t border-border/50 pt-4">
        <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-secondary/50 transition-colors cursor-pointer group">
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-primary/20 to-secondary flex items-center justify-center text-xs font-bold text-primary border border-border ring-2 ring-transparent group-hover:ring-primary/20 transition-all flex-shrink-0">
            {getUserInitials()}
          </div>
          <motion.div
            animate={{
              display: open ? "block" : "none",
              opacity: open ? 1 : 0,
            }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-hidden"
          >
            <p className="text-sm font-medium text-foreground group-hover:text-foreground whitespace-nowrap">{getDisplayName()}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email || 'email@example.com'}</p>
          </motion.div>
          <motion.div
            animate={{
              display: open ? "block" : "none",
              opacity: open ? 1 : 0,
            }}
            transition={{ duration: 0.2 }}
          >
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors"
              title="Sair"
            >
              <LogOut className="w-4 h-4 text-muted-foreground hover:text-destructive transition-colors" />
            </button>
          </motion.div>
        </div>
      </div>
    </>
  );
};

const AppSidebar: React.FC = () => {
  const [open, setOpen] = useState(true);

  return (
    <Sidebar open={open} setOpen={setOpen}>
      <SidebarBody className="justify-between gap-10 bg-card/50 backdrop-blur-xl border-r border-border/50">
        <SidebarContent />
      </SidebarBody>
    </Sidebar>
  );
};

export default AppSidebar;
