# R8 rules for the release build. Capacitor finds plugins by class name and reads their annotations
# at runtime, so those names and annotations must survive shrinking and renaming.

# Capacitor reads @CapacitorPlugin, @PluginMethod and the permission annotations by reflection.
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod

# The bridge, plugin handles and the WebView JS interface look up their members by name.
-keep class com.getcapacitor.** { *; }

# Our plugins (registered in MainActivity): the class, and every @PluginMethod / callback on it.
-keep @com.getcapacitor.annotation.CapacitorPlugin class * {
    @com.getcapacitor.PluginMethod <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}

# Android starts the autofill service, its activity and the clipboard job from the manifest, and the
# job by ComponentName; keep the app package's classes by name so the stack traces stay readable too.
-keep class com.brewedops.kapevault.** { *; }

# Stack traces from the field: keep file and line, hide the original file name.
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile
