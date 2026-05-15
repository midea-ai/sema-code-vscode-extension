// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "SemaPet",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "SemaPet",
            path: ".",
            exclude: ["build-zips.sh"],
            sources: ["Sources"],
            resources: [.copy("Assets")]
        )
    ]
)
