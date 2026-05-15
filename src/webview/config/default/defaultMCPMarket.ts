export interface MCPMarketInfo {
    config: {
        name: string;
        title?: string;  // 用于页面展示的名称，优先于 name
        transport: 'stdio' | 'sse' | 'http';
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        headers?: Record<string, string>;
    };
    description: string;
    readonly require?: Record<string, string>;
    github?: string;
    tools: string[];
    tags: string[];
}

export const defaultMCPMarketInfos: MCPMarketInfo[] = [
    {
        "config": {
            "title": "File System",
            "name": "filesystem",
            "transport": "stdio",
            "command": "npx",
            "args": [
                "-y",
                "@modelcontextprotocol/server-filesystem",
                "/absolute/path/to/dir"
            ]
        },
        "require": { "/absolute/path/to/dir": "绝对目录路径" },
        "description": "提供全面的文件系统操作，包括读写、移动文件、目录管理，以及支持模式匹配与格式化的高级文件编辑功能",
        "github": "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
        "tools": [
            "read_file",
            "read_text_file",
            "read_media_file",
            "read_multiple_files",
            "write_file",
            "edit_file",
            "create_directory",
            "list_directory",
            "list_directory_with_sizes",
            "move_file",
            "search_files",
            "directory_tree",
            "get_file_info",
            "list_allowed_directories"
        ],
        "tags": ["文件系统", "文件管理", "目录操作", "文件搜索", "文件编辑"]
    },
    {
        "config": {
            "name": "context7",
            "transport": "stdio",
            "command": "npx",
            "args": [
                "-y",
                "@upstash/context7-mcp",
                "--api-key",
                "YOUR_API_KEY"
            ],
            "env": {
                "DEFAULT_MINIMUM_TOKENS": "6000"
            }
        },
        "require": { "YOUR_API_KEY": "Context7 API Key" },
        "description": "在LLM提示中直接提供最新的库文档和代码示例，确保准确且实时的编程辅助",
        "github": "https://github.com/upstash/context7",
        "tools": ["resolve-library-id", "query-docs"],
        "tags": ["文档", "代码示例", "API参考", "库文档", "编程帮助"]
    },
    {
        "config": {
            "name": "sequential-thinking",
            "transport": "stdio",
            "command": "npx",
            "args": [
                "-y",
                "@modelcontextprotocol/server-sequential-thinking"
            ],
            "env": {
                "DISABLE_THOUGHT_LOGGING": "true"
            }
        },
        "description": "将复杂问题分解成可管理的步骤，通过逐步分析提供深度推理能力",
        "github": "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
        "tools": ["sequentialThinking"],
        "tags": ["推理", "思维", "分析", "问题解决"]
    },
    {
        "config": {
            "name": "git-tools",
            "transport": "stdio",
            "command": "uvx",
            "args": ["mcp-server-git", "--repository", "path/to/git/repo"]
        },
        "require": { "path/to/git/repo": "本地Git仓库路径" },
        "description": "提供 Git 仓库交互与自动化工具，支持通过状态、差异、提交、分支管理等命令对 Git 仓库进行读取、搜索和操作",
        "github": "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
        "tools": [
            "git_status",
            "git_diff_unstaged",
            "git_diff_staged",
            "git_diff",
            "git_commit",
            "git_add",
            "git_reset",
            "git_log",
            "git_create_branch",
            "git_checkout",
            "git_show",
            "git_branch"
        ],
        "tags": ["版本控制", "git", "仓库管理"]
    },
    {
        "config": {
            "name": "fetch",
            "transport": "stdio",
            "command": "npx",
            "args": [
                "mcp-fetch-server"
            ]
        },
        "description": "提供以多种格式获取网络内容的功能，包括HTML、JSON、纯文本和Markdown，支持自定义标头和内容转换",
        "github": "https://github.com/zcaceres/fetch-mcp",
        "tools": ["fetch_html", "fetch_json", "fetch_txt", "fetch_markdown"],
        "tags": ["网络获取", "html", "json", "markdown", "内容提取"]
    },
    {
        "config": {
            "name": "playwright",
            "transport": "stdio",
            "command": "npx",
            "args": ["@playwright/mcp@latest"]
        },
        "description": "使用 Playwright 提供浏览器自动化功能，通过结构化的可访问性树与网页交互，无需截图或视觉处理",
        "github": "https://github.com/executeautomation/mcp-playwright",
        "tools": [
            'start_codegen_session',
            'end_codegen_session',
            'get_codegen_session',
            'clear_codegen_session',
            "playwright_navigate",
            "playwright_screenshot",
            "playwright_click",
            "playwright_iframe_click",
            "playwright_iframe_fill",
            "playwright_fill",
            "playwright_select",
            "playwright_hover",
            "playwright_upload_file",
            "playwright_evaluate",
            "playwright_resize",
            "playwright_close",
            "playwright_expect_response",
            "playwright_assert_response",
            "playwright_custom_user_agent",
            "playwright_get_visible_text",
            "playwright_get_visible_html",
            "playwright_go_back",
            "playwright_go_forward",
            "playwright_drag",
            "playwright_press_key",
            "playwright_save_as_pdf",
            "playwright_click_and_switch_tab",
            "playwright_get",
            "playwright_post",
            "playwright_put",
            "playwright_delete",
            "playwright_patch"
        ],
        "tags": ["浏览器", "自动化", "网页测试", "屏幕截图"]
    },
    {
        "config": {
            "name": "github",
            "transport": "stdio",
            "command": "npx",
            "args": [
                "-y",
                "@modelcontextprotocol/server-github"
            ],
            "env": {
                "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_ACCESS_TOKEN"
            }
        },
        "require": { "GITHUB_ACCESS_TOKEN": "GitHub API访问令牌" },
        "description": "提供全面的GitHub API集成，支持仓库管理、问题处理、拉取请求和代码操作，包含身份验证和企业级支持",
        "tools": [
            "create_or_update_file",
            "search_repositories",
            "create_repository",
            "get_file_contents",
            "push_files",
            "create_issue",
            "create_pull_request",
            "fork_repository",
            "create_branch",
            "list_commits",
            "list_issues",
            "update_issue",
            "add_issue_comment",
            "search_code",
            "search_issues",
            "search_users",
            "get_issue",
            "get_pull_request",
            "list_pull_requests",
            "create_pull_request_review",
            "merge_pull_request",
            "get_pull_request_files",
            "get_pull_request_status",
            "update_pull_request_branch",
            "get_pull_request_comments",
            "get_pull_request_reviews"
        ],
        "tags": ["版本控制", "GitHub", "仓库管理", "代码协作"]
    },
    {
        "config": {
            "name": "memory",
            "transport": "stdio",
            "command": "npx",
            "args": [
                "-y",
                "@modelcontextprotocol/server-memory"
            ],
            "env": {
                "MEMORY_FILE_PATH": "/path/to/custom/memory.jsonl"
            }
        },
        "require": { "/path/to/custom/memory.jsonl": "持久化记忆文件路径" },
        "description": "基于知识图谱的持久化记忆系统，帮助 AI 记住用户偏好和上下文",
        "github": "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
        "tools": [
            "create_entities",
            "create_relations",
            "add_observations",
            "delete_entities",
            "delete_observations",
            "delete_relations",
            "read_graph",
            "search_nodes",
            "open_nodes"
        ],
        "tags": ["记忆", "知识图谱", "上下文"]
    },
    {
        "config": {
            "name": "time",
            "transport": "stdio",
            "command": "uvx",
            "args": [
                "mcp-server-time"
            ]
        },
        "description": "提供使用IANA时区名称进行时间和时区转换的功能，支持自动检测系统时区，并能够查询当前时间",
        "github": "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
        "tools": [
            "get_current_time",
            "convert_time"
        ],
        "tags": ["时区", "时间转换", "日期时间", "日程安排"]
    },
    {
        "config": {
            "name": "excel",
            "transport": "stdio",
            "command": "uvx",
            "args": ["excel-mcp-server", "stdio"]
        },
        "description": "在无需安装 Microsoft Excel 的情况下，创建、读取和修改 Excel workbooks",
        "github": "https://github.com/haris-musa/excel-mcp-server",
        "tools": [
            "create_workbook",
            "create_worksheet",
            "get_workbook_metadata",
            "write_data_to_excel",
            "read_data_from_excel",
            "format_range",
            "merge_cells",
            "unmerge_cells",
            "apply_formula",
            "validate_formula_syntax",
            "create_chart",
            "create_pivot_table",
            "copy_worksheet",
            "delete_worksheet",
            "rename_worksheet",
            "copy_range",
            "delete_range",
            "validate_excel_range"
        ],
        "tags": ["Excel", "读写表格", "Excel 工作簿", "Excel workbooks"]
    },
    {
        "config": {
            "title": "MySQL",
            "name": "mysql",
            "transport": "stdio",
            "command": "uvx",
            "args": [
                "--from",
                "mysql-mcp-server",
                "mysql_mcp_server"
            ],
            "env": {
                "MYSQL_HOST": "localhost",
                "MYSQL_PORT": "3306",
                "MYSQL_USER": "MYSQL_USER_VALUE",
                "MYSQL_PASSWORD": "MYSQL_PW_VALUE",
                "MYSQL_DATABASE": "MYSQL_DB_VALUE"
            }
        },
        "require": {
            "MYSQL_USER_VALUE": "MySQL 用户名",
            "MYSQL_PW_VALUE": "MySQL 密码",
            "MYSQL_DB_VALUE": "MySQL 数据库名",
        },
        "description": "实现与 MySQL 数据库的安全交互，使数据库探索和分析通过受控界面更加安全和结构化",
        "github": "https://github.com/designcomputer/mysql_mcp_server",
        "tools": [
            "execute_sql"
        ],
        "tags": ["SQL查询", "数据库", "mysql", "数据库操作", "数据管理"]
    },
    {
        "config": {
            "name": "kubernetes",
            "transport": "stdio",
            "command": "npx",
            "args": ["mcp-server-kubernetes"],
            "env": {
                "ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS": "true"
            }
        },
        "description": "连接并管理Kubernetes集群，通过kubectl集成实现Pod、服务和部署操作",
        "github": "https://github.com/Flux159/mcp-server-kubernetes",
        "tools": [
            "kubectl_get",
            "kubectl_describe",
            "kubectl_list",
            "kubectl_logs",
            "explain_resource",
            "list_api_resources",
            "kubectl_apply",
            "kubectl_create",
            "kubectl_scale",
            "kubectl_patch",
            "kubectl_rollout",
            "install_helm_chart",
            "upgrade_helm_chart",
            "port_forward",
            "stop_port_forward",
            "kubectl_context"
        ],
        "tags": ["虚拟化", "Kubernetes", "容器", "集群管理"]
    },
    {
        "config": {
            "name": "docker",
            "transport": "stdio",
            "command": "uvx",
            "args": ["docker-mcp"]
        },
        "description": "用于 Docker 操作的强大的模型上下文协议 (MCP) 服务器，实现无缝的容器和合成栈管理",
        "github": "https://github.com/QuantGeekDev/docker-mcp",
        "tools": [
            "create-container",
            "create-container",
            "get-logs",
            "list-containers"
        ],
        "tags": ["虚拟化", "docker", "容器管理"]
    },
    {
        "config": {
            "name": "everything-search",
            "transport": "stdio",
            "command": "uvx",
            "args": ["mcp-server-everything-search"]
        },
        "description": "提供 Windows、macOS 和 Linux 上快速的文件搜索功能。在 Windows 上，它使用了 Everything SDK。在 macOS 上，它使用内置的 mdfind 命令。在 Linux 上，它使用 locate/plocate 命令。",
        "github": "https://github.com/mamertofabian/mcp-everything-search",
        "tools": [
            "search"
        ],
        "tags": ["文件搜索", "跨平台检索", "极速查找", "本地扫描"]
    },
    {
        "config": {
            "name": "gitee",
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@gitee/mcp-gitee@latest"],
            "env": {
                "GITEE_API_BASE": "https://gitee.com/api/v5",
                "GITEE_ACCESS_TOKEN": "YOUR_ACCESS_TOKEN"
            }
        },
        "require": { "YOUR_ACCESS_TOKEN": "Gitee 访问令牌" },
        "description": "提供了一套与 Ggitee API 交互的工具，使 AI 助手能够管理仓库、问题、拉取请求等",
        "github": "https://github.com/oschina/mcp-gitee",
        "tools": [
            "list_user_repos",
            "get_file_content",
            "create_user_repo",
            "create_org_repo",
            "create_enter_repo",
            "fork_repository",
            "create_release",
            "list_releases",
            "search_open_source_repositories",
            "list_repo_pulls",
            "merge_pull",
            "create_pull",
            "update_pull",
            "get_pull_detail",
            "comment_pull",
            "list_pull_comments",
            "create_issue",
            "update_issue",
            "get_repo_issue_detail",
            "list_repo_issues",
            "comment_issue",
            "list_issue_comments",
            "get_user_info",
            "search_users",
            "list_user_notifications"
        ],
        "tags": ["仓库操作", "gitee", "代码管理", "版本控制"]
    },
    {
        "config": {
            "name": "maven",
            "transport": "stdio",
            "command": "npx",
            "args": ["mcp-maven-deps"]
        },
        "description": "提供检查 Maven 依赖版本的工具。该服务器使 LLM 能够验证 Maven 依赖关系，并从 Maven 中央仓库检索最新版本。",
        "github": "https://github.com/Bigsy/maven-mcp-server",
        "tools": [
            "get_maven_latest_version",
            "check_maven_version_exists"
        ],
        "tags": ["maven", "依赖管理", "版本控制"]
    }
]