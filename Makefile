# Makefile

# Application name
APP_NAME := minecraft-mod-manager
EXECUTABLE_NAME := mmm


# Build output directory
BUILD_DIR := build

# Go build command
GO_BUILD := go build -o

# Targets
.PHONY: all clean build build-darwin build-linux build-windows

# Build for all platforms
all: clean build

run:
	go run cmd/$(APP_NAME)/main.go

# Clean build directory
ifeq ($(PLATFORM), Unix)
clean:
	go clean -cache -modcache -i -r
	if [ -d "$(BUILD_DIR)" ]; then rm -rf $(BUILD_DIR); fi
else
clean:
	go clean -cache -modcache -i -r
	@if exist $(BUILD_DIR) rmdir /S /Q $(BUILD_DIR)
endif


# Create build directory
ifeq ($(PLATFORM), Unix)
BUILD_DIR:
	if [ ! -d "$(BUILD_DIR)" ]; then mkdir -p $(BUILD_DIR); fi
else
BUILD_DIR:
	@if not exist $(BUILD_DIR) mkdir $(BUILD_DIR)
endif

# Build for all platforms
build: BUILD_DIR build-darwin build-linux build-windows

# Build for macOS
build-darwin: BUILD_DIR
	@set GOOS=darwin
	@set GOARCH=amd64
	$(GO_BUILD) $(BUILD_DIR)/darwin/$(EXECUTABLE_NAME) main.go

# Build for Linux
build-linux: BUILD_DIR
	@set GOOS=linux
	@set GOARCH=amd64
	$(GO_BUILD) $(BUILD_DIR)/linux/$(EXECUTABLE_NAME) main.go

# Build for Windows
build-windows: BUILD_DIR
	@set GOOS=windows
	@set GOARCH=amd64
	$(GO_BUILD) $(BUILD_DIR)/windows/$(EXECUTABLE_NAME).exe main.go

test:
	go test ./internal/...

coverage:
	go test ./internal/... -coverprofile=coverage.out

coverage-enforce: coverage
	go tool cover -func=coverage.out | awk '/^total:/ { if ($$3 != "100.0%") { print "Coverage is not 100%: " $$3; exit 1 } else { print "Coverage is 100%"; exit 0 } }'

coverage-html: coverage
	go tool cover -html=coverage.out -o coverage.html

lang-sync:
	locize sync --ver latest --compare-modification-time true --update-values true --format flat --path ./internal/i18n/localise
	go run cmd/lang/buildLang.go
