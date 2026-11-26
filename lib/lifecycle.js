// Historic syncs mirrored GitHub status into lifecycle and wrote both repository
// flags and a check timestamp. An explicit source takes precedence over inference.
export function storedRepositoryStatus(details) {
  const github = details.githubMetadata;
  const isFlag = flag => [true, false, 0, 1].includes(flag);
  if (typeof github?.checkedAt !== 'string' || !Number.isFinite(Date.parse(github.checkedAt)) ||
      !isFlag(github.archived) || !isFlag(github.disabled)) return null;
  if (github.disabled) return 'Disabled';
  return github.archived ? 'Archived' : 'Active';
}

export function registryLifecycle(details, repoStatus = storedRepositoryStatus(details)) {
  const lifecycle = details.lifecycle;
  if (typeof lifecycle !== 'string' || details.lifecycleSource === 'github') return null;
  if (details.lifecycleSource !== 'registry' && repoStatus &&
      lifecycle === (repoStatus === 'Active' ? 'active' : 'archived')) return null;
  return lifecycle;
}
