function getMcpAccess(pathname) {
  return pathname === '/mcp' ? { kind: 'streamable-http' } : { kind: 'none' };
}

export { getMcpAccess };
