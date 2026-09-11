# Assigning a variable is not declaring one. terraform-ls answers
# workspace/symbol with a String symbol per line here, named for the variable
# and located at the assignment, which is the row that used to outrank the
# `variable "Store"` block that actually declares it.
Store = "acme"
