import React, { useEffect, useState } from 'react';
import { UserPlus, Search, Loader2, X, Check, Edit2, Users, Settings, Trash2, ShieldCheck } from 'lucide-react';
import { Button } from './Button';
import { api } from '../services/api';
import { TeamMember, type Team as TeamType, type TeamFunction } from '../types';
import { supabase } from '@/integrations/supabase/client';
import TeamConfigModal from './TeamConfigModal';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const Team: React.FC = () => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [teams, setTeams] = useState<TeamType[]>([]);
  const [functions, setFunctions] = useState<TeamFunction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [formData, setFormData] = useState({ 
    name: '', 
    email: '', 
    role: 'agent',
    team_id: '',
    function_id: '',
    weight: 1
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [registrationSettingsId, setRegistrationSettingsId] = useState<string | null>(null);
  const [updatingRegistration, setUpdatingRegistration] = useState(false);
  const [editFormData, setEditFormData] = useState({
    name: '',
    email: '',
    role: 'agent',
    status: 'invited' as 'active' | 'invited' | 'disabled',
    team_id: '',
    function_id: '',
    weight: 1
  });

  useEffect(() => {
    loadAllData();
    const cleanup = setupRealtime();
    return cleanup;
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [membersData, teamsData, functionsData] = await Promise.all([
        api.fetchTeam(),
        api.fetchTeams(),
        api.fetchTeamFunctions()
      ]);
      setMembers(membersData);
      setTeams(teamsData);
      setFunctions(functionsData);

      // Load registration setting
      const { data: settingsData } = await supabase
        .from('system_settings')
        .select('*')
        .maybeSingle();
      
      setRegistrationEnabled(settingsData?.registration_enabled ?? true);
      setRegistrationSettingsId(settingsData?.id ?? null);
    } catch (error) {
      console.error("Erro ao carregar dados da equipe", error);
    } finally {
      setLoading(false);
    }
  };

  const setupRealtime = () => {
    const channel = supabase
      .channel('team-members-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, () => {
        loadAllData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleRegistrationToggle = async (enabled: boolean) => {
    setUpdatingRegistration(true);
    try {
      if (registrationSettingsId) {
        await supabase
          .from('system_settings')
          .update({ registration_enabled: enabled })
          .eq('id', registrationSettingsId);
      } else {
        const { data } = await supabase
          .from('system_settings')
          .insert({ registration_enabled: enabled })
          .select()
          .single();
        if (data) setRegistrationSettingsId(data.id);
      }
      setRegistrationEnabled(enabled);
      toast.success(enabled ? 'Registro de novos usuários habilitado' : 'Registro de novos usuários desabilitado');
    } catch (error) {
      console.error('Erro ao atualizar configuração de registro:', error);
      toast.error('Erro ao atualizar configuração');
    } finally {
      setUpdatingRegistration(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      await api.createTeamMember({
        name: formData.name,
        email: formData.email,
        role: formData.role as 'agent' | 'admin' | 'manager',
        team_id: formData.team_id || undefined,
        function_id: formData.function_id || undefined,
        weight: formData.weight
      });

      toast.success('Membro convidado com sucesso!');
      setShowModal(false);
      setFormData({ name: '', email: '', role: 'agent', team_id: '', function_id: '', weight: 1 });
      await loadAllData();
    } catch (error) {
      console.error('Erro ao convidar membro:', error);
      toast.error('Erro ao convidar membro. Verifique se o email já não está cadastrado.');
    }
  };

  const handleUpdateMember = async (id: string, field: string, value: any) => {
    try {
      await api.updateTeamMember(id, { [field]: value });
      toast.success('Membro atualizado com sucesso');
    } catch (error) {
      console.error('Erro ao atualizar membro:', error);
      toast.error('Erro ao atualizar membro');
    }
  };

  const handleDeleteMember = async (id: string, name: string) => {
    if (!confirm(`Tem certeza que deseja excluir ${name}?`)) return;
    try {
      await api.deleteTeamMember(id);
      toast.success('Membro removido com sucesso');
      await loadAllData();
    } catch (error) {
      console.error('Erro ao remover membro:', error);
      toast.error('Erro ao remover membro');
    }
  };

  const handleEditClick = (member: TeamMember) => {
    setEditingMember(member);
    setEditFormData({
      name: member.name,
      email: member.email,
      role: member.role,
      status: member.status,
      team_id: member.team_id || '',
      function_id: member.function_id || '',
      weight: member.weight || 1
    });
    setShowEditModal(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;

    try {
      await api.updateTeamMember(editingMember.id, {
        name: editFormData.name,
        email: editFormData.email,
        role: editFormData.role as 'admin' | 'manager' | 'agent',
        status: editFormData.status,
        team_id: editFormData.team_id || null,
        function_id: editFormData.function_id || null,
        weight: editFormData.weight
      });
      toast.success('Membro atualizado com sucesso!');
      setShowEditModal(false);
      setEditingMember(null);
      await loadAllData();
    } catch (error) {
      console.error('Erro ao editar membro:', error);
      toast.error('Erro ao editar membro');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
        case 'active':
            return <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-950 border border-slate-700 text-white shadow-sm">Ativo</span>;
        case 'invited':
            return <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-950 border border-amber-900/50 text-amber-500 shadow-sm">Pendente</span>;
        default:
            return <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-950 border border-slate-800 text-slate-500 shadow-sm">Inativo</span>;
    }
  };

  // Filtered members based on search
  const filteredMembers = members.filter(m => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const teamName = teams.find(t => t.id === m.team_id)?.name || '';
    const funcName = functions.find(f => f.id === m.function_id)?.name || '';
    return (
      m.name.toLowerCase().includes(term) ||
      m.email.toLowerCase().includes(term) ||
      teamName.toLowerCase().includes(term) ||
      funcName.toLowerCase().includes(term)
    );
  });

  // Dynamic stats
  const stats = {
    total: members.length,
    admins: members.filter(m => m.role === 'admin').length,
    members: members.filter(m => m.role !== 'admin').length,
    teams: teams.length
  };

  return (
    <div className="p-8 h-full overflow-y-auto bg-slate-950 text-slate-50 relative custom-scrollbar">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Equipe</h2>
          <p className="text-sm text-slate-400 mt-1">Gerencie usuários e times da organização</p>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => setShowConfigModal(true)} variant="outline" className="border-slate-700">
            <Settings className="w-4 h-4 mr-2" />
            Configurar
          </Button>
          <Button onClick={() => setShowModal(true)} className="shadow-lg shadow-cyan-500/20 bg-slate-100 text-slate-900 hover:bg-white hover:text-black">
            <UserPlus className="w-4 h-4 mr-2" />
            Convidar Usuário
          </Button>
        </div>
      </div>

      {/* Registration Control */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 shadow-sm mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <Label htmlFor="registration-toggle" className="text-sm font-medium text-slate-200 cursor-pointer">
                Permitir novos registros
              </Label>
              <p className="text-xs text-slate-500 mt-0.5">
                {registrationEnabled 
                  ? 'Novos usuários podem criar conta na plataforma' 
                  : 'Registro de novos usuários está bloqueado'}
              </p>
            </div>
          </div>
          <Switch
            id="registration-toggle"
            checked={registrationEnabled}
            onCheckedChange={handleRegistrationToggle}
            disabled={updatingRegistration}
          />
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 shadow-sm">
            <div className="text-sm font-medium text-slate-400 mb-2">Total de Usuários</div>
            <div className="text-3xl font-bold text-white">{loading ? '-' : stats.total}</div>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 shadow-sm">
            <div className="text-sm font-medium text-slate-400 mb-2">Admins</div>
            <div className="text-3xl font-bold text-white">{loading ? '-' : stats.admins}</div>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 shadow-sm">
            <div className="text-sm font-medium text-slate-400 mb-2">Membros</div>
            <div className="text-3xl font-bold text-white">{loading ? '-' : stats.members}</div>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 shadow-sm">
            <div className="text-sm font-medium text-slate-400 mb-2">Times Ativos</div>
            <div className="text-3xl font-bold text-white">{stats.teams}</div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <input 
            type="text" 
            placeholder="Buscar por nome, email, time ou função..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full sm:w-96 pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-800 rounded-lg text-sm text-slate-200 focus:ring-1 focus:ring-slate-700 outline-none placeholder:text-slate-600 transition-all"
        />
      </div>

      {/* Main Table Card */}
      <div className="bg-slate-900/30 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="p-6 border-b border-slate-800">
            <h3 className="text-lg font-bold text-white">Usuários da Equipe</h3>
            <p className="text-sm text-slate-500 mt-1">Gerencie roles e times dos usuários</p>
        </div>

        {loading ? (
             <div className="flex flex-col items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-500 mb-3" />
                <span className="text-sm text-slate-400">Carregando dados...</span>
           </div>
        ) : members.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12">
                <Users className="w-12 h-12 text-slate-600 mb-4" />
                <p className="text-slate-400 mb-4">Nenhum membro cadastrado ainda.</p>
                <Button onClick={() => setShowModal(true)} className="bg-slate-100 text-slate-900 hover:bg-white">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Convidar Primeiro Membro
                </Button>
            </div>
        ) : (
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-slate-800/50">
                            <th className="px-6 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider">Usuário</th>
                            <th className="px-6 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider">Email</th>
                            <th className="px-6 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider">Role</th>
                            <th className="px-6 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider">Time</th>
                            <th className="px-6 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider">Função</th>
                            <th className="px-6 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider">Peso</th>
                            <th className="px-6 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider text-center">Status</th>
                            <th className="px-6 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider text-center">Ações</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/30">
                        {filteredMembers.map((member) => (
                            <tr key={member.id} className="hover:bg-slate-800/20 transition-colors group">
                                {/* User Info */}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center gap-3">
                                        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300 border border-slate-700 uppercase">
                                            {member.name.substring(0, 2)}
                                        </div>
                                        <span className="text-sm font-medium text-slate-200">{member.name}</span>
                                    </div>
                                </td>
                                
                                {/* Email */}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className="text-sm text-slate-400">{member.email}</span>
                                </td>

                                {/* Role Selector */}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <select
                                        value={member.role}
                                        onChange={(e) => handleUpdateMember(member.id, 'role', e.target.value)}
                                        className="w-32 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-md text-sm text-slate-300 cursor-pointer hover:border-slate-600 transition-colors"
                                    >
                                        <option value="agent">Atendente</option>
                                        <option value="manager">Gerente</option>
                                        <option value="admin">Admin</option>
                                    </select>
                                </td>

                                {/* Time Selector */}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <select
                                        value={member.team_id || ''}
                                        onChange={(e) => handleUpdateMember(member.id, 'team_id', e.target.value || null)}
                                        className="w-32 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-md text-sm text-slate-300 cursor-pointer hover:border-slate-600 transition-colors"
                                    >
                                        <option value="">Sem time</option>
                                        {teams.map(team => (
                                            <option key={team.id} value={team.id}>{team.name}</option>
                                        ))}
                                    </select>
                                </td>

                                {/* Function Selector */}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <select
                                        value={member.function_id || ''}
                                        onChange={(e) => handleUpdateMember(member.id, 'function_id', e.target.value || null)}
                                        className="w-32 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-md text-sm text-slate-300 cursor-pointer hover:border-slate-600 transition-colors"
                                    >
                                        <option value="">Sem função</option>
                                        {functions.map(func => (
                                            <option key={func.id} value={func.id}>{func.name}</option>
                                        ))}
                                    </select>
                                </td>

                                {/* Weight */}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <input
                                        type="number"
                                        min="1"
                                        max="10"
                                        value={member.weight || 1}
                                        onChange={(e) => handleUpdateMember(member.id, 'weight', parseInt(e.target.value))}
                                        className="w-16 px-2 py-1 bg-slate-950 border border-slate-800 rounded-md text-sm text-slate-300 text-center"
                                    />
                                </td>

                                {/* Status */}
                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                    {getStatusBadge(member.status)}
                                </td>

                                {/* Actions */}
                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                    <div className="flex items-center justify-center gap-1">
                                        <button 
                                            onClick={() => handleEditClick(member)}
                                            className="p-2 rounded-lg text-slate-500 hover:bg-slate-800 hover:text-white transition-colors"
                                            title="Editar membro"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button 
                                            onClick={() => handleDeleteMember(member.id, member.name)}
                                            className="p-2 rounded-lg text-slate-500 hover:bg-red-900/50 hover:text-red-400 transition-colors"
                                            title="Excluir membro"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
      </div>

      {/* Invite Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-white">Convidar para a Equipe</h3>
                    <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <form onSubmit={handleInvite} className="p-6 space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Nome Completo</label>
                        <input 
                            required
                            type="text" 
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white focus:ring-1 focus:ring-slate-600 outline-none transition-all"
                            placeholder="Ex: João da Silva"
                            value={formData.name}
                            onChange={(e) => setFormData({...formData, name: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Email Corporativo</label>
                        <input 
                            required
                            type="email" 
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white focus:ring-1 focus:ring-slate-600 outline-none transition-all"
                            placeholder="colaborador@empresa.com"
                            value={formData.email}
                            onChange={(e) => setFormData({...formData, email: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Nível de Acesso</label>
                        <div className="grid grid-cols-3 gap-2">
                            {['agent', 'manager', 'admin'].map((role) => (
                                <div 
                                    key={role}
                                    onClick={() => setFormData({...formData, role})}
                                    className={`cursor-pointer rounded-lg border p-2 text-center transition-all ${
                                        formData.role === role 
                                        ? 'bg-slate-800 border-slate-500 text-white' 
                                        : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700'
                                    }`}
                                >
                                    <div className="text-xs font-bold uppercase mb-1">{role === 'agent' ? 'Atendente' : role === 'manager' ? 'Gerente' : 'Admin'}</div>
                                    {formData.role === role && <div className="flex justify-center"><Check className="w-3 h-3" /></div>}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Time (opcional)</label>
                        <select
                            value={formData.team_id}
                            onChange={(e) => setFormData({...formData, team_id: e.target.value})}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white"
                        >
                            <option value="">Sem time</option>
                            {teams.map(team => (
                                <option key={team.id} value={team.id}>{team.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Função (opcional)</label>
                        <select
                            value={formData.function_id}
                            onChange={(e) => setFormData({...formData, function_id: e.target.value})}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white"
                        >
                            <option value="">Sem função</option>
                            {functions.map(func => (
                                <option key={func.id} value={func.id}>{func.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Peso (para distribuição)</label>
                        <input
                            type="number"
                            min="1"
                            max="10"
                            value={formData.weight}
                            onChange={(e) => setFormData({...formData, weight: parseInt(e.target.value)})}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white"
                        />
                    </div>

                    <div className="pt-4 flex gap-3">
                        <Button type="button" variant="ghost" onClick={() => setShowModal(false)} className="flex-1 border border-slate-700 hover:bg-slate-800">Cancelar</Button>
                        <Button type="submit" className="flex-1 bg-white text-black hover:bg-slate-200">Enviar Convite</Button>
                    </div>
                </form>
            </div>
        </div>
      )}

      {/* Config Modal */}
      <TeamConfigModal 
        isOpen={showConfigModal} 
        onClose={() => setShowConfigModal(false)} 
        onUpdate={loadAllData}
      />

      {/* Edit Member Modal */}
      {showEditModal && editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-white">Editar Membro</h3>
                    <button onClick={() => { setShowEditModal(false); setEditingMember(null); }} className="text-slate-400 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Nome Completo</label>
                        <input 
                            required
                            type="text" 
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white focus:ring-1 focus:ring-slate-600 outline-none transition-all"
                            value={editFormData.name}
                            onChange={(e) => setEditFormData({...editFormData, name: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Email</label>
                        <input 
                            required
                            type="email" 
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white focus:ring-1 focus:ring-slate-600 outline-none transition-all"
                            value={editFormData.email}
                            onChange={(e) => setEditFormData({...editFormData, email: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Nível de Acesso</label>
                        <div className="grid grid-cols-3 gap-2">
                            {['agent', 'manager', 'admin'].map((role) => (
                                <div 
                                    key={role}
                                    onClick={() => setEditFormData({...editFormData, role})}
                                    className={`cursor-pointer rounded-lg border p-2 text-center transition-all ${
                                        editFormData.role === role 
                                        ? 'bg-slate-800 border-slate-500 text-white' 
                                        : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700'
                                    }`}
                                >
                                    <div className="text-xs font-bold uppercase mb-1">{role === 'agent' ? 'Atendente' : role === 'manager' ? 'Gerente' : 'Admin'}</div>
                                    {editFormData.role === role && <div className="flex justify-center"><Check className="w-3 h-3" /></div>}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Status</label>
                        <select
                            value={editFormData.status}
                            onChange={(e) => setEditFormData({...editFormData, status: e.target.value as 'active' | 'invited' | 'disabled'})}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white"
                        >
                            <option value="active">Ativo</option>
                            <option value="invited">Pendente</option>
                            <option value="disabled">Inativo</option>
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Time</label>
                        <select
                            value={editFormData.team_id}
                            onChange={(e) => setEditFormData({...editFormData, team_id: e.target.value})}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white"
                        >
                            <option value="">Sem time</option>
                            {teams.map(team => (
                                <option key={team.id} value={team.id}>{team.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Função</label>
                        <select
                            value={editFormData.function_id}
                            onChange={(e) => setEditFormData({...editFormData, function_id: e.target.value})}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white"
                        >
                            <option value="">Sem função</option>
                            {functions.map(func => (
                                <option key={func.id} value={func.id}>{func.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Peso</label>
                        <input
                            type="number"
                            min="1"
                            max="10"
                            value={editFormData.weight}
                            onChange={(e) => setEditFormData({...editFormData, weight: parseInt(e.target.value)})}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white"
                        />
                    </div>

                    <div className="pt-4 flex gap-3">
                        <Button type="button" variant="ghost" onClick={() => { setShowEditModal(false); setEditingMember(null); }} className="flex-1 border border-slate-700 hover:bg-slate-800">Cancelar</Button>
                        <Button type="submit" className="flex-1 bg-white text-black hover:bg-slate-200">Salvar Alterações</Button>
                    </div>
                </form>
            </div>
        </div>
      )}
    </div>
  );
};

export default Team;