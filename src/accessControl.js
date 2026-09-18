export function resolveAgendaPermissions({pairedMode=false,viewingOwn=false,managedMinor=false,managedAccount=managedMinor,selectedDependent=false}){
  return {
    canManage:!pairedMode&&((viewingOwn&&!managedAccount)||selectedDependent),
    canToggle:pairedMode||viewingOwn||selectedDependent,
    readOnly:!pairedMode&&!viewingOwn&&!selectedDependent,
  };
}
