package com.brewedops.kapevault

import android.text.InputType
import com.brewedops.kapevault.LoginForm.Companion.FieldFacts
import com.brewedops.kapevault.LoginForm.Companion.Kind
import com.brewedops.kapevault.LoginForm.Companion.Origin
import com.brewedops.kapevault.LoginForm.Companion.onePage
import com.brewedops.kapevault.LoginForm.Companion.kindOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// Which fields of a screen are the login's username and password. The walk over Android's AssistStructure
// (web domains, visibility) needs a phone and is proven on the emulator; this is the per-field decision.
class LoginFormTest {
    private fun field(
        hints: List<String> = emptyList(),
        html: Map<String, String> = emptyMap(),
        tag: String? = null,
        inputType: Int = InputType.TYPE_CLASS_TEXT,
        names: List<String> = emptyList(),
        className: String? = null,
    ) = FieldFacts(hints, html, tag, inputType, names, className)

    @Test
    fun `an autofill hint of password is a password`() {
        assertEquals(Kind.PASSWORD, kindOf(field(hints = listOf("password"))))
    }

    @Test
    fun `a web password input is a password`() {
        assertEquals(Kind.PASSWORD, kindOf(field(html = mapOf("type" to "password"), tag = "input")))
        assertEquals(Kind.PASSWORD, kindOf(field(html = mapOf("autocomplete" to "current-password"))))
    }

    @Test
    fun `a new password field is not the saved password`() {
        assertEquals(Kind.OTHER, kindOf(field(hints = listOf("newpassword"))))
        assertEquals(Kind.OTHER, kindOf(field(html = mapOf("type" to "password", "autocomplete" to "new-password"))))
    }

    @Test
    fun `buttons, hidden inputs, checkboxes and radios are never filled`() {
        for (type in listOf("hidden", "submit", "button", "checkbox", "radio")) {
            assertEquals(type, Kind.OTHER, kindOf(field(html = mapOf("type" to type), names = listOf("password"))))
        }
    }

    @Test
    fun `a field that says it is a username is an explicit username`() {
        assertEquals(Kind.EXPLICIT_USERNAME, kindOf(field(hints = listOf("username"))))
        assertEquals(Kind.EXPLICIT_USERNAME, kindOf(field(html = mapOf("autocomplete" to "username"))))
    }

    @Test
    fun `an email field is a username, but not an explicit one`() {
        assertEquals(Kind.USERNAME, kindOf(field(hints = listOf("emailaddress"))))
        assertEquals(Kind.USERNAME, kindOf(field(html = mapOf("type" to "email"))))
    }

    @Test
    fun `native input types decide when nothing is marked`() {
        assertEquals(Kind.PASSWORD, kindOf(field(inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)))
        assertEquals(Kind.PASSWORD, kindOf(field(inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD)))
        assertEquals(Kind.USERNAME, kindOf(field(inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)))
        // A number pad has the same bits as a text variation, but it is not a text class.
        assertEquals(Kind.OTHER, kindOf(field(inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD)))
    }

    @Test
    fun `a field with no marks is read by its own name`() {
        assertEquals(Kind.PASSWORD, kindOf(field(names = listOf("login_pwd"))))
        assertEquals(Kind.USERNAME, kindOf(field(names = listOf("user_name"))))
        assertEquals(Kind.USERNAME, kindOf(field(names = listOf("Your E-Mail"))))
    }

    @Test
    fun `an unmarked text box is only a candidate, and other views are not fields`() {
        assertEquals(Kind.TEXT, kindOf(field(className = "android.widget.EditText")))
        assertEquals(Kind.TEXT, kindOf(field(tag = "input", html = mapOf("type" to "text"))))
        assertEquals(Kind.TEXT, kindOf(field(tag = "input")))
        assertEquals(Kind.OTHER, kindOf(field(className = "android.widget.TextView")))
        assertEquals(Kind.OTHER, kindOf(field(tag = "input", html = mapOf("type" to "number"))))
    }

    @Test
    fun `a password beats a username word in the same name`() {
        assertEquals(Kind.PASSWORD, kindOf(field(names = listOf("user_password"))))
    }

    @Test
    fun `fields in one document name that page`() {
        val bank = Origin("https", "bank.example")
        assertEquals(bank, onePage(listOf(bank, bank)))
    }

    @Test
    fun `fields in different documents, or none, name no page`() {
        val bank = Origin("https", "bank.example")
        assertNull(onePage(listOf(bank, Origin("https", "ads.example"))))
        assertNull(onePage(listOf(bank, null)))
        assertNull(onePage(listOf(null, null)))
        assertNull(onePage(emptyList()))
        // The same host over http is another document.
        assertNull(onePage(listOf(bank, Origin("http", "bank.example"))))
    }
}
