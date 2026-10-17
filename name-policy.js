export function isDisallowedGymName(name) {
  return typeof name === 'string' && name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('es') === 'hairon ass';
}
export const NAME_POLICY_ERROR = 'Por políticas de la empresa, el nombre “Hairon ass” no puede utilizarse. Elige otro nombre para tu gimnasio.';
export const REMOVAL_NOTICE = 'Por políticas de la empresa, el nombre “Hairon ass” no puede utilizarse. El perfil del gimnasio fue retirado. Puedes registrar tu gimnasio con otro nombre.';
