import type { Appointment } from '../types';

export function getAppointmentDetails(appointment: Appointment) {
  const vetsoft = appointment.metadata?.vetsoft;
  const isVetsoft = appointment.vetsoft_event_id != null || appointment.metadata?.source === 'vetsoft';
  const patient = vetsoft?.patient_name || appointment.animal?.name || null;
  const tutor = vetsoft?.tutor_name || appointment.contact?.name || null;
  const procedure = vetsoft?.procedure_name || appointment.procedure?.name || null;
  return {
    isVetsoft,
    patient,
    tutor,
    procedure,
    title: isVetsoft && (patient || tutor) ? [patient, tutor].filter(Boolean).join(' • ') : appointment.title,
  };
}
