from app.blackbox import BlackBox


def test_event_survives_reopen(tmp_path):
    db_path = tmp_path / "blackbox.sqlite3"
    BlackBox(db_path).append("self_check", {"status": "okay"})
    items = BlackBox(db_path).recent()
    assert len(items) == 1
    assert items[0]["kind"] == "self_check"
    assert items[0]["payload"] == {"status": "okay"}
