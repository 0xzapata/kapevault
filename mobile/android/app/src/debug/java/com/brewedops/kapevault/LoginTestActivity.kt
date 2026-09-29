package com.brewedops.kapevault

import android.app.Activity
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Debug builds only: a plain sign-in screen that npm run proof fills through KAPEVault's autofill
 * service, standing in for another app (its own task; LoginForm.mayFill lets this one screen through).
 * The line under the fields says what landed: the username, and only the password's length.
 */
class LoginTestActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (24 * resources.displayMetrics.density).toInt()
        val result = TextView(this).apply { contentDescription = "Test result" }
        fun field(label: String, type: Int, hint: String) = EditText(this).apply {
            this.hint = label
            contentDescription = label
            inputType = type
            setAutofillHints(hint)
        }
        val username = field("Test username", InputType.TYPE_CLASS_TEXT, View.AUTOFILL_HINT_USERNAME)
        val password = field("Test password", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD, View.AUTOFILL_HINT_PASSWORD)
        val show = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                result.text = "filled: ${username.text} / ${password.text.length}"
            }
        }
        username.addTextChangedListener(show)
        password.addTextChangedListener(show)
        setContentView(
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(pad, pad * 3, pad, pad)
                addView(TextView(this@LoginTestActivity).apply { text = "Test login" })
                addView(username)
                addView(password)
                addView(result)
            },
        )
    }
}
