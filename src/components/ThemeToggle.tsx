import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '', showLabel = false }) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? 'Mudar para o modo claro' : 'Mudar para o modo escuro'}
      aria-label={isDark ? 'Mudar para o modo claro' : 'Mudar para o modo escuro'}
      className={`inline-flex items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 py-2 text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors ${className}`}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      {showLabel && (
        <span className="text-xs font-medium whitespace-nowrap">
          {isDark ? 'Modo claro' : 'Modo escuro'}
        </span>
      )}
    </button>
  );
};

export default ThemeToggle;
