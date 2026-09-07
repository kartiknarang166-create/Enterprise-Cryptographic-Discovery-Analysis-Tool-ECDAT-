// Offline fallback BOM used when the API is unreachable.
// We generate a fresh UUID at module load so the serial number is always unique.
function _uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

export const FALLBACK_BOM = {
  "bomFormat": "CycloneDX",
  "specVersion": "1.6",
  "serialNumber": `urn:uuid:${_uuid()}`,
  "_offlineMode": true,
  "version": 1,
  "metadata": {
    "timestamp": new Date().toISOString(),
    "component": {
      "type": "application",
      "name": "Offline Mode Application"
    }
  },
  "components": [
    {
      "bom-ref": "comp-1",
      "type": "cryptographic-asset",
      "name": "RSA-2048",
      "description": "Legacy RSA key exchange",
      "mosca": {
        "risk_level": "CRITICAL",
        "x_years_data_sensitivity": 5,
        "y_years_migration_time": 3,
        "z_years_until_crqc": 5
      },
      "recommendation": {
        "pqc_algorithm": "ML-KEM-768",
        "action": "Migrate to ML-KEM"
      },
      "evidence": {
        "occurrences": [
          { "location": "/dummy_target/auth/login.js", "line": 42 }
        ]
      }
    },
    {
      "bom-ref": "comp-2",
      "type": "cryptographic-asset",
      "name": "AES-256-GCM",
      "description": "Symmetric encryption",
      "mosca": {
        "risk_level": "LOW",
        "x_years_data_sensitivity": 5,
        "y_years_migration_time": 1,
        "z_years_until_crqc": 15
      },
      "recommendation": {
        "pqc_algorithm": "AES-256",
        "action": "Maintain AES-256"
      },
      "evidence": {
        "occurrences": [
          { "location": "/dummy_target/crypto/utils.js", "line": 15 }
        ]
      }
    },
    {
      "bom-ref": "comp-3",
      "type": "cryptographic-asset",
      "name": "MD5",
      "description": "Deprecated Hash Algorithm",
      "mosca": {
        "risk_level": "CRITICAL",
        "x_years_data_sensitivity": 1,
        "y_years_migration_time": 1,
        "z_years_until_crqc": 0
      },
      "recommendation": {
        "pqc_algorithm": "SHA-3",
        "action": "Migrate to SHA-3"
      },
      "evidence": {
        "occurrences": [
          { "location": "/dummy_target/legacy/hash.js", "line": 12 }
        ]
      }
    },
    {
      "bom-ref": "comp-4",
      "type": "cryptographic-asset",
      "name": "ECDSA",
      "description": "Elliptic Curve Digital Signature Algorithm",
      "mosca": {
        "risk_level": "CRITICAL",
        "x_years_data_sensitivity": 7,
        "y_years_migration_time": 3,
        "z_years_until_crqc": 6
      },
      "recommendation": {
        "pqc_algorithm": "ML-DSA-65",
        "action": "Migrate to ML-DSA"
      },
      "evidence": {
        "occurrences": [
          { "location": "/dummy_target/auth/cert.js", "line": 88 }
        ]
      }
    }
  ],
  "summary": {
    "total_findings": 4,
    "critical_count": 3
  }
}
