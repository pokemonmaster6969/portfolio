export const validateFormData = {
  isValidHost: (host: string): boolean => {
    const hostPattern = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/
    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/
    return hostPattern.test(host) || ipPattern.test(host)
  },

  isValidPort: (port: number): boolean => {
    return port > 0 && port <= 65535
  },

  isValidUsername: (username: string): boolean => {
    return username.trim().length > 0
  },

  isValidPassword: (password: string): boolean => {
    return password.length > 0
  },

  isValidPath: (path: string): boolean => {
    return path.trim().length > 0
  }
}
