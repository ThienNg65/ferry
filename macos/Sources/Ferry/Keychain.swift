import Foundation
import Security

/// Master key for the credential store, kept in the app's own Keychain item (no `security` CLI).
enum MasterKey {
  private static let service = "js.ferry.app"
  private static let account = "master-key"

  static func load() -> Data? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true
    ]
    var out: CFTypeRef?
    if SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data, data.count == 32 {
      return data
    }
    var key = Data(count: 32)
    let status = key.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
    guard status == errSecSuccess else { return nil }
    let add: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecValueData as String: key
    ]
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess ? key : nil
  }
}
