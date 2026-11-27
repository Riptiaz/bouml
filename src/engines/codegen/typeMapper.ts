import { TargetLanguage } from '../../model/schema';

const TYPE_TABLES: Record<TargetLanguage, Record<string, string>> = {
  cpp: {
    void: 'void',
    string: 'std::string',
    int: 'int',
    long: 'int64_t',
    float: 'float',
    double: 'double',
    bool: 'bool',
    boolean: 'bool',
    Date: 'std::chrono::system_clock::time_point',
    DateTime: 'std::chrono::system_clock::time_point',
    UUID: 'std::string',
    any: 'std::any',
  },
  java: {
    void: 'void',
    string: 'String',
    int: 'int',
    long: 'long',
    float: 'float',
    double: 'double',
    bool: 'boolean',
    boolean: 'boolean',
    Date: 'LocalDate',
    DateTime: 'LocalDateTime',
    UUID: 'UUID',
    any: 'Object',
  },
  python: {
    void: 'None',
    string: 'str',
    int: 'int',
    long: 'int',
    float: 'float',
    double: 'float',
    bool: 'bool',
    boolean: 'bool',
    Date: 'date',
    DateTime: 'datetime',
    UUID: 'UUID',
    any: 'Any',
  },
  typescript: {
    void: 'void',
    string: 'string',
    int: 'number',
    long: 'number',
    float: 'number',
    double: 'number',
    bool: 'boolean',
    boolean: 'boolean',
    Date: 'Date',
    DateTime: 'Date',
    UUID: 'string',
    any: 'unknown',
  },
  php: {
    void: 'void',
    string: 'string',
    int: 'int',
    long: 'int',
    float: 'float',
    double: 'float',
    bool: 'bool',
    boolean: 'bool',
    Date: '\\DateTimeImmutable',
    DateTime: '\\DateTimeImmutable',
    UUID: 'string',
    any: 'mixed',
  },
  sql: {
    string: 'VARCHAR(255)',
    int: 'INTEGER',
    long: 'BIGINT',
    float: 'REAL',
    double: 'DOUBLE PRECISION',
    bool: 'BOOLEAN',
    boolean: 'BOOLEAN',
    Date: 'DATE',
    DateTime: 'TIMESTAMP',
    UUID: 'UUID',
    any: 'JSONB',
  },
  rust: {
    void: '()',
    string: 'String',
    int: 'i32',
    long: 'i64',
    float: 'f32',
    double: 'f64',
    bool: 'bool',
    boolean: 'bool',
    Date: 'String',
    DateTime: 'String',
    UUID: 'String',
    any: 'serde_json::Value',
  },
  go: {
    void: '',
    string: 'string',
    int: 'int',
    long: 'int64',
    float: 'float32',
    double: 'float64',
    bool: 'bool',
    boolean: 'bool',
    Date: 'time.Time',
    DateTime: 'time.Time',
    UUID: 'string',
    any: 'any',
  },
  idl: {
    void: 'void',
    string: 'string',
    int: 'long',
    long: 'long long',
    float: 'float',
    double: 'double',
    bool: 'boolean',
    boolean: 'boolean',
    Date: 'string',
    DateTime: 'string',
    UUID: 'string',
    any: 'any',
  },
};

export function mapType(rawType: string, lang: TargetLanguage): string {
  const trimmed = rawType.trim();
  if (!trimmed) return lang === 'python' ? 'None' : 'void';

  const listMatch = trimmed.match(/^List<(.+)>$/i);
  if (listMatch) {
    const inner = mapType(listMatch[1], lang);
    switch (lang) {
      case 'cpp':
        return `std::vector<${inner}>`;
      case 'java':
        return `List<${inner}>`;
      case 'python':
        return `list[${inner}]`;
      case 'typescript':
        return `${inner}[]`;
      case 'php':
        return 'array';
      case 'rust':
        return `Vec<${inner}>`;
      case 'go':
        return `[]${inner}`;
      case 'idl':
        return `sequence<${inner}>`;
      case 'sql':
        return 'JSONB';
    }
  }

  const optMatch = trimmed.match(/^Optional<(.+)>$/i);
  if (optMatch) {
    const inner = mapType(optMatch[1], lang);
    switch (lang) {
      case 'cpp':
        return `std::optional<${inner}>`;
      case 'java':
        return `Optional<${inner}>`;
      case 'python':
        return `Optional[${inner}]`;
      case 'typescript':
        return `${inner} | null`;
      case 'php':
        return `?${inner}`;
      case 'rust':
        return `Option<${inner}>`;
      case 'go':
        return `*${inner}`;
      default:
        return inner;
    }
  }

  return TYPE_TABLES[lang][trimmed] ?? trimmed;
}
