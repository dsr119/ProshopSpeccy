-- Each finger grip records its brand (Turbo, Vise or Other); Other means the brand goes in the notes.

create or replace function private.fit_field_kinds()
returns table (key text, kind text, label text)
language sql
immutable
set search_path = ''
as $$
  values
    ('hand', 'enum_hand', 'Bowling hand'),
    ('play_style', 'enum_play_style', 'One or two handed'),
    ('thumb_mode', 'enum_thumb_mode', 'Thumb mode'),
    ('fit_label', 'text_short', 'Fit label'),
    ('finger_grips', 'enum_grips', 'Finger grips'),
    ('grip_type', 'enum_grip_type', 'Grip type'),
    ('middle_grip_brand', 'text_short', 'Middle finger grip brand'),
    ('ring_grip_brand', 'text_short', 'Ring finger grip brand'),
    ('middle_grip_size', 'length', 'Middle finger grip size'),
    ('middle_hole', 'length', 'Middle finger hole size'),
    ('middle_oval', 'text_short', 'Middle finger oval'),
    ('middle_lateral_pitch', 'pitch_lateral', 'Middle finger lateral pitch'),
    ('middle_fr_pitch', 'pitch_fr', 'Middle finger forward/reverse pitch'),
    ('middle_inserts', 'text_short', 'Middle finger inserts'),
    ('ring_grip_size', 'length', 'Ring finger grip size'),
    ('ring_hole', 'length', 'Ring finger hole size'),
    ('ring_oval', 'text_short', 'Ring finger oval'),
    ('ring_lateral_pitch', 'pitch_lateral', 'Ring finger lateral pitch'),
    ('ring_fr_pitch', 'pitch_fr', 'Ring finger forward/reverse pitch'),
    ('ring_inserts', 'text_short', 'Ring finger inserts'),
    ('bridge', 'length', 'Bridge'),
    ('span_type', 'enum_span_type', 'Span shown'),
    ('middle_cut_to_cut', 'length', 'Middle finger cut to cut'),
    ('ring_cut_to_cut', 'length', 'Ring finger cut to cut'),
    ('middle_full_span', 'length', 'Middle finger full span'),
    ('ring_full_span', 'length', 'Ring finger full span'),
    ('middle_cut_to_outer', 'length', 'Middle finger cut to outer'),
    ('ring_cut_to_outer', 'length', 'Ring finger cut to outer'),
    ('middle_actual_cut', 'length', 'Middle span actual-cut'),
    ('ring_actual_cut', 'length', 'Ring span actual-cut'),
    ('thumb_hole', 'length', 'Thumb hole size'),
    ('thumb_oval', 'text_short', 'Thumb oval'),
    ('thumb_lateral_pitch', 'pitch_lateral', 'Thumb lateral pitch'),
    ('thumb_fr_pitch', 'pitch_fr', 'Thumb forward/reverse pitch'),
    ('thumb_oval_angle', 'angle', 'Thumb oval angle'),
    ('thumb_od', 'length', 'Thumb slug size'),
    ('thumb_insert_type', 'enum_thumb_insert', 'Thumb insert type'),
    ('rev_rate', 'stat', 'Rev rate'),
    ('axis_rotation', 'stat', 'Axis rotation'),
    ('axis_tilt', 'stat', 'Axis tilt'),
    ('speed', 'stat', 'Speed'),
    ('pap_horizontal', 'length', 'P.A.P horizontal'),
    ('pap_vertical', 'pitch_ud', 'P.A.P vertical'),
    ('written_by', 'text_short', 'Specs written by'),
    ('finger_insert_details', 'text_long', 'Finger insert details'),
    ('thumb_system_details', 'text_long', 'Thumb system details'),
    ('fitting_notes', 'text_long', 'Fitting notes')
$$;
