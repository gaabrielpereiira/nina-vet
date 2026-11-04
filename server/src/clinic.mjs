import { ApiError } from './errors.mjs';

const invalid = () => new ApiError(400, 'INVALID_QUERY', 'Confira os filtros da consulta.');
const missing = () => new ApiError(404, 'NOT_FOUND', 'Registro não encontrado.');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const contactColumns = `revision, id, name, call_name, phone_number, email, tags, notes,
  is_business, is_blocked, vetsoft_client_id, first_contact_date, last_activity, created_at, updated_at`;

function filters(url, allowed) {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw invalid();
  }
  const integer = (key, fallback, max) => {
    const raw = url.searchParams.get(key);
    if (raw === null) return fallback;
    if (!/^\d{1,7}$/.test(raw) || Number(raw) > max || (key === 'limit' && Number(raw) < 1)) throw invalid();
    return Number(raw);
  };
  const limit = integer('limit', 50, 100);
  const offset = integer('offset', 0, 1000000);
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (q.length > 120 || /[\x00-\x1f]/.test(q)) throw invalid();
  const dates = {};
  for (const key of ['from', 'to']) {
    const value = url.searchParams.get(key);
    if (value !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-') || !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value) throw invalid();
      dates[key] = value;
    }
  }
  if (dates.from && dates.to && dates.from > dates.to) throw invalid();
  return { limit, offset, q, ...dates };
}

function page(rows, { limit, offset }) {
  const more = rows.length > limit;
  return { data: rows.slice(0, limit), next_offset: more ? offset + limit : null };
}

export function createClinic(db, auth, options={}) {
  return async function read(request) {
    const url = new URL(request.url);
    const suffix = url.pathname.slice('/v1/clinic/'.length);
    const { user } = await auth.authenticate(request);
    // SET LOCAL is reset on commit/rollback, including pooled connections.
    return db.transaction(async tx => {
      await tx.query("SELECT set_config('nina.user_id', $1, true)", [user.id]);
      if (suffix === 'contacts') {
        const f = filters(url, ['limit', 'offset', 'q']);
        const rows = await tx.query(`SELECT ${contactColumns} FROM nina_clinic.contacts
          WHERE $1 = '' OR strpos(lower(coalesce(name, '')), lower($1)) > 0
            OR strpos(phone_number, $1) > 0 OR strpos(lower(coalesce(email, '')), lower($1)) > 0
          ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`, [f.q, f.limit + 1, f.offset]);
        return page(rows, f);
      }
      if (suffix === 'procedures') {
        const f = filters(url, ['limit', 'offset', 'q']);
        return page(await tx.query(`SELECT revision, id, name, description, category, requirements,
            price_type, price, price_min, price_max, duration_minutes, is_active, source
          FROM nina_clinic.procedures WHERE $1 = '' OR strpos(lower(name), lower($1)) > 0
          ORDER BY name, id LIMIT $2 OFFSET $3`, [f.q, f.limit + 1, f.offset]), f);
      }
      const single = suffix.match(/^(appointments|procedures)\/([^/]+)$/);
      if (single) {
        if (!uuid.test(single[2])) throw invalid();
        filters(url, []);
        const columns = single[1] === 'appointments' ? 'revision,id,title,description,date::text,time::text,duration,type,status,contact_id,animal_id,procedure_id' : 'revision,id,name,description,category,requirements,price_type,price,price_min,price_max,duration_minutes,is_active';
        const [row] = await tx.query(`SELECT ${columns} FROM nina_clinic.${single[1]} WHERE id=$1`, [single[2]]);
        if (!row) throw missing();
        return { data: row };
      }
      const pet = suffix.match(/^contacts\/([^/]+)\/animals\/([^/]+)$/);
      if (pet) {
        if (!uuid.test(pet[1]) || !uuid.test(pet[2])) throw invalid();
        filters(url, []);
        const [row] = await tx.query('SELECT revision,id,contact_id,name,species,breed,sex,birth_date::text,notes FROM nina_clinic.animals WHERE contact_id=$1 AND id=$2',pet.slice(1));
        if (!row) throw missing();
        return { data: row };
      }
      const match = suffix.match(/^contacts\/([^/]+)(?:\/(animals|appointments|messages))?$/);
      let contactId = null;
      if (match) {
        contactId = match[1];
        if (!uuid.test(contactId)) throw invalid();
        const [contact] = await tx.query(`SELECT ${contactColumns} FROM nina_clinic.contacts WHERE id = $1`, [contactId]);
        if (!contact) throw missing();
        if (!match[2]) { filters(url, []); return { data: contact }; }
        if (match[2] === 'animals') {
          const f = filters(url, ['limit', 'offset', 'q']);
          return page(await tx.query(`SELECT revision, id, contact_id, name, species, breed, sex,
              birth_date::text, notes, vetsoft_animal_id FROM nina_clinic.animals
            WHERE contact_id = $1 AND ($4 = '' OR strpos(lower(name),lower($4)) > 0) ORDER BY created_at, id LIMIT $2 OFFSET $3`,
          [contactId, f.limit + 1, f.offset, f.q]), f);
        }
        if (match[2] === 'messages') {
          const f = filters(url, ['limit', 'offset']);
          const attachments=options.mediaEnabled ? `,coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id',mf.file_id,'position',mf.position,'type',mf.type,'is_sticker',mf.is_sticker,'voice',mf.voice,
            'mime',f.mime,'bytes',f.byte_count,'filename',f.display_name) ORDER BY mf.position)
            FROM nina_channels.message_files mf JOIN nina_channels.media_files f ON f.id=mf.file_id
            WHERE mf.message_id=m.id),'[]'::jsonb) AS attachments` : '';
          return page(await tx.query(`SELECT m.id, m.conversation_id, m.type, m.from_type,
              m.content, m.status, m.sent_at, m.created_at ${attachments}
            FROM nina_clinic.messages m JOIN nina_clinic.conversations c ON c.id = m.conversation_id
            WHERE c.contact_id = $1 ORDER BY m.sent_at DESC, m.id LIMIT $2 OFFSET $3`,
          [contactId, f.limit + 1, f.offset]), f);
        }
      }
      if (suffix === 'appointments' || match?.[2] === 'appointments') {
        const f = filters(url, ['limit', 'offset', 'from', 'to']);
        return page(await tx.query(`SELECT a.revision, a.id, a.title, a.description, a.date::text,
            a.time::text, a.duration, a.type, a.status, a.contact_id, a.animal_id,
            a.procedure_id, c.name AS contact_name, p.name AS procedure_name, n.name AS animal_name
          FROM nina_clinic.appointments a
          LEFT JOIN nina_clinic.contacts c ON c.id = a.contact_id
          LEFT JOIN nina_clinic.procedures p ON p.id = a.procedure_id
          LEFT JOIN nina_clinic.animals n ON n.id = a.animal_id
          WHERE ($1::uuid IS NULL OR a.contact_id = $1)
            AND ($2::date IS NULL OR a.date >= $2) AND ($3::date IS NULL OR a.date <= $3)
          ORDER BY a.date DESC, a.time DESC, a.id LIMIT $4 OFFSET $5`,
        [contactId, f.from ?? null, f.to ?? null, f.limit + 1, f.offset]), f);
      }
      throw missing();
    });
  };
}
