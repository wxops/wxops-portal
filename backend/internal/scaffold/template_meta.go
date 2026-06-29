package scaffold

// TemplateMeta is parsed from template.yaml inside each template subdirectory.
type TemplateMeta struct {
	Name        string            `yaml:"name"        json:"name"`
	Title       string            `yaml:"title"       json:"title,omitempty"`
	Description string            `yaml:"description" json:"description,omitempty"`
	Tags        []string          `yaml:"tags"        json:"tags,omitempty"`
	Runtime     *TemplateRuntime  `yaml:"runtime"     json:"runtime,omitempty"`
	Defaults    *TemplateDefaults `yaml:"defaults"    json:"defaults,omitempty"`
	Recommends  *TemplateFeatures `yaml:"recommends"  json:"recommends,omitempty"`
}

// TemplateRuntime describes the language runtime for this template.
type TemplateRuntime struct {
	Language       string                 `yaml:"language"       json:"language"`
	Version        *TemplateVersionChoice `yaml:"version"        json:"version,omitempty"`
	PackageManager *TemplateChoice        `yaml:"packageManager" json:"packageManager,omitempty"`
}

// TemplateVersionChoice holds the default and available runtime versions.
type TemplateVersionChoice struct {
	Default string   `yaml:"default" json:"default"`
	Options []string `yaml:"options" json:"options"`
}

// TemplateChoice holds a default and options for a selectable field.
type TemplateChoice struct {
	Default string   `yaml:"default" json:"default"`
	Options []string `yaml:"options" json:"options"`
}

// TemplateDefaults provides pre-filled values for the wizard form.
type TemplateDefaults struct {
	Port          int32  `yaml:"port"           json:"port,omitempty"`
	Replicas      int32  `yaml:"replicas"       json:"replicas,omitempty"`
	CPURequest    string `yaml:"cpuRequest"     json:"cpuRequest,omitempty"`
	MemRequest    string `yaml:"memoryRequest"  json:"memoryRequest,omitempty"`
	CPULimit      string `yaml:"cpuLimit"       json:"cpuLimit,omitempty"`
	MemLimit      string `yaml:"memoryLimit"    json:"memoryLimit,omitempty"`
	HealthPath    string `yaml:"healthPath"     json:"healthPath,omitempty"`
	LivenessPath  string `yaml:"livenessPath"   json:"livenessPath,omitempty"`
	ReadinessPath string `yaml:"readinessPath"  json:"readinessPath,omitempty"`
	MetricsPath   string `yaml:"metricsPath"    json:"metricsPath,omitempty"`
}

// TemplateFeatures indicates which platform toggles the template recommends.
type TemplateFeatures struct {
	Vault      bool   `yaml:"vault"      json:"vault,omitempty"`
	Database   bool   `yaml:"database"   json:"database,omitempty"`
	API        bool   `yaml:"api"        json:"api,omitempty"`
	APIType    string `yaml:"apiType"    json:"apiType,omitempty"`
	Ingress    bool   `yaml:"ingress"    json:"ingress,omitempty"`
	Monitoring bool   `yaml:"monitoring" json:"monitoring,omitempty"`
}
