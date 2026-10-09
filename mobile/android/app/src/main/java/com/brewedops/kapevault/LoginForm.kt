package com.brewedops.kapevault

import android.app.assist.AssistStructure
import android.app.assist.AssistStructure.ViewNode
import android.content.ComponentName
import android.content.Context
import android.content.pm.ApplicationInfo
import android.service.autofill.Dataset
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue

/**
 * The login fields on a screen Android asks KAPEVault to fill, and whose screen it is. Read from the
 * screen's structure by the autofill service (to offer the fill) and again by AutofillAuthActivity (to
 * fill it), so nothing about a request is kept between the two. It holds field ids, never values.
 *
 * webDomain / webScheme: the page the login fields are on, as the screen reports it - trusted only from
 * a checked browser (TrustedBrowsers). Each field belongs to the document it sits in (its nearest
 * ancestor with a web domain), so fields inside a cross-origin frame (an ad on a bank's page) are that
 * frame's, never the page's. When the fields are not all in one document, there is no domain at all.
 * addressBar: the page came from a compatibility-mode browser's address bar instead (see parse). That
 * gives up two things: no field has a document, so a cross-origin frame's fields are named by the bar
 * too, and the bar hides the scheme, so an http page cannot be told from an https one.
 */
class LoginForm private constructor(
    val packageName: String,
    val webDomain: String?,
    val webScheme: String?,
    val addressBar: Boolean,
    private val usernames: List<AutofillId>,
    private val passwords: List<AutofillId>,
) {
    val ids get() = usernames + passwords
    val hasUsername get() = usernames.isNotEmpty()
    val hasPassword get() = passwords.isNotEmpty()

    // The filled result: the chosen login's username and password in every matching field. A value
    // left empty leaves its fields alone. null when there is nothing to fill.
    // The builder that takes Field and Presentations is API 33; this app starts at 30.
    @Suppress("DEPRECATION")
    fun filled(username: String, password: String): Dataset? {
        val values = (if (username.isEmpty()) emptyList() else usernames.map { it to username }) +
            (if (password.isEmpty()) emptyList() else passwords.map { it to password })
        if (values.isEmpty()) return null
        val dataset = Dataset.Builder()
        for ((id, value) in values) dataset.setValue(id, AutofillValue.forText(value))
        return dataset.build()
    }

    companion object {
        // compat: FillRequest.FLAG_COMPATIBILITY_MODE_REQUEST - Android reads the browser through its
        // accessibility bridge and names the page only on the address bar, beside the fields.
        fun parse(structure: AssistStructure, compat: Boolean): LoginForm? {
            val usernames = mutableListOf<AutofillId>()
            val passwords = mutableListOf<AutofillId>()
            val origins = mutableListOf<Origin?>() // the document of every field taken, usernames and passwords alike
            val named = mutableSetOf<Origin>() // every domain the screen names, on any node
            var explicitUsername = false
            var textBeforePassword: Pair<AutofillId, Origin?>? = null

            fun visit(node: ViewNode, inherited: Origin?) {
                val own = node.webDomain?.takeIf { it.isNotBlank() }?.let { Origin(node.webScheme?.lowercase(), it.lowercase()) }
                own?.let { named += it }
                val origin = own ?: inherited
                val id = node.autofillId
                if (id != null && node.autofillType == View.AUTOFILL_TYPE_TEXT && node.visibility == View.VISIBLE) {
                    when (kindOf(node)) {
                        Kind.PASSWORD -> {
                            passwords += id
                            origins += origin
                        }
                        Kind.USERNAME -> {
                            usernames += id
                            origins += origin
                        }
                        Kind.EXPLICIT_USERNAME -> {
                            usernames += id
                            origins += origin
                            explicitUsername = true
                        }
                        Kind.TEXT -> if (passwords.isEmpty()) textBeforePassword = id to origin
                        Kind.OTHER -> {}
                    }
                }
                for (i in 0 until node.childCount) visit(node.getChildAt(i), origin)
            }
            for (i in 0 until structure.windowNodeCount) visit(structure.getWindowNodeAt(i).rootViewNode, null)

            // A form with a password and no marked username: the text field just before it is the username.
            if (passwords.isNotEmpty() && usernames.isEmpty()) textBeforePassword?.let { (id, origin) ->
                usernames += id
                origins += origin
            }
            // Without a password field, only a field that says it is a username counts (a sign-in that asks
            // for the username first), never a lone email field such as a newsletter's.
            if (passwords.isEmpty() && !explicitUsername) return null
            // A compatibility-mode request whose fields sit in no document: the one domain the screen
            // names (its address bar) is the page. Never for a native request, where it would be a guess.
            val bar = if (compat && origins.all { it == null }) named.singleOrNull() else null
            val page = onePage(origins) ?: bar
            return LoginForm(structure.activityComponent.packageName, page?.domain, page?.scheme, bar != null, usernames, passwords)
        }

        // A web document's address: http or https (null when the screen does not say), and its host.
        data class Origin(val scheme: String?, val domain: String)

        // The one document every login field sits in, or null when they disagree or none says.
        fun onePage(origins: List<Origin?>): Origin? = origins.distinct().singleOrNull()

        // Never into KAPEVault itself: the vault's own fields (the master password) are not a site's
        // login. Debug builds carry one test screen the device proof fills, as if it were another app.
        fun mayFill(context: Context, screen: ComponentName): Boolean {
            if (screen.packageName != context.packageName) return true
            val debuggable = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
            return debuggable && screen.className == "${context.packageName}.LoginTestActivity"
        }

        internal enum class Kind { PASSWORD, USERNAME, EXPLICIT_USERNAME, TEXT, OTHER }

        // What kindOf looks at in one view, read off the node so the decision itself needs no Android view.
        // hints and html (attribute names and values) are lower case; names: the id entry, the hint, and the
        // html name and id, whichever the view has.
        internal class FieldFacts(
            val hints: List<String>,
            val html: Map<String, String>,
            val htmlTag: String?,
            val inputType: Int,
            val names: List<String>,
            val className: String?,
        )

        private fun factsOf(node: ViewNode): FieldFacts {
            val html = node.htmlInfo?.attributes.orEmpty().associate { (it.first ?: "").lowercase() to (it.second ?: "").lowercase() }
            return FieldFacts(
                hints = node.autofillHints.orEmpty().map { it.lowercase() },
                html = html,
                htmlTag = node.htmlInfo?.tag,
                inputType = node.inputType,
                names = listOfNotNull(node.idEntry, node.hint, html["name"], html["id"]),
                className = node.className?.toString(),
            )
        }

        internal fun kindOf(node: ViewNode) = kindOf(factsOf(node))

        internal fun kindOf(field: FieldFacts): Kind {
            val hints = field.hints
            val html = field.html
            val type = html["type"]
            val autocomplete = html["autocomplete"].orEmpty()
            // A new password (sign up, change password) is not the saved one.
            if (hints.any { "new" in it } || "new-password" in autocomplete) return Kind.OTHER
            if (type == "hidden" || type == "submit" || type == "button" || type == "checkbox" || type == "radio") return Kind.OTHER
            if (hints.any { "password" in it } || type == "password" || "current-password" in autocomplete) return Kind.PASSWORD
            if (hints.any { it == "username" } || "username" in autocomplete) return Kind.EXPLICIT_USERNAME
            if (hints.any { "email" in it } || type == "email" || "email" in autocomplete) return Kind.USERNAME

            val input = field.inputType
            if (input and InputType.TYPE_MASK_CLASS == InputType.TYPE_CLASS_TEXT) {
                when (input and InputType.TYPE_MASK_VARIATION) {
                    InputType.TYPE_TEXT_VARIATION_PASSWORD, InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD, InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD -> return Kind.PASSWORD
                    InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS -> return Kind.USERNAME
                }
            }
            // Screens that mark nothing: go by the field's own name.
            val names = field.names.joinToString(" ").lowercase()
            if (PASSWORD_WORDS.any { it in names }) return Kind.PASSWORD
            if (USERNAME_WORDS.any { it in names }) return Kind.USERNAME
            val editable = field.className?.endsWith("EditText") == true || (field.htmlTag == "input" && (type == null || type == "text"))
            return if (editable) Kind.TEXT else Kind.OTHER
        }

        private val PASSWORD_WORDS = listOf("password", "passwd", "pwd")
        private val USERNAME_WORDS = listOf("user", "login", "email", "e-mail")
    }
}
